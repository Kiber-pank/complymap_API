import { FastifyPluginAsync, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';

/**
 * Стандартная структура ответа при ошибке.
 * Гарантирует единый формат для всех клиентов (frontend, mobile, внешние интеграции).
 */
export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  details?: Array<{
    path: string;
    message: string;
    code?: string;
  }>;
}

/**
 * Fastify-плагин для настройки компилятора валидации Zod и централизованного обработчика ошибок.
 * 
 * КОНЦЕПЦИИ FASTIFY:
 * 1. setValidatorCompiler: По умолчанию Fastify использует Ajv для валидации схем JSON Schema.
 *    Мы заменяем его на Zod. Компилятор получает схему маршрута и возвращает функцию, 
 *    которая проверяет входные данные. Если валидация падает, Fastify автоматически 
 *    прерывает обработку и вызывает errorHandler со статусом 400.
 * 2. setErrorHandler: Ловит все ошибки: от валидации, бизнес-логики, драйвера БД и не пойманные исключения.
 *    Работает в инкапсулированном контексте плагина. Регистрируя его в корне приложения,
 *    мы делаем его глобальным "щитом" для всех маршрутов.
 * 3. Безопасность: Никогда не передаём `error.stack`, `error.code` или сырые SQL-сообщения клиенту.
 *    В production `5xx` ошибки маскируются под общее сообщение, а детали пишутся только в лог.
 */
export const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  // Интеграция Zod как компилятора схем валидации
  fastify.setValidatorCompiler(({ schema }) => {
    // Приводим схему к типу Zod, так как Fastify ожидает JSON Schema, а мы подсовываем Zod
    const zodSchema = schema as z.ZodType<unknown>;
    
    return (data: unknown) => {
      // safeParse не бросает исключения, возвращает результат { success, data, error }
      const result = zodSchema.safeParse(data);
      if (!result.success) {
        // Бросаем ZodError. Fastify автоматически выставит statusCode: 400
        // и передаст эту ошибку в setErrorHandler
        throw result.error;
      }
      // Возвращаем распарсенные и типизированные данные
      return { value: result.data };
    };
  });

  // Централизованный обработчик всех ошибок
  fastify.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      // Логируем полную ошибку с контекстом запроса для мониторинга (Sentry, ELK, CloudWatch)
      request.log.error({ err: error }, 'Обработка ошибки в API');

      const statusCode = error.statusCode ?? 500;
      const isClientError = statusCode >= 400 && statusCode < 500;

      // Базовая структура ответа
      let response: ErrorResponse = {
        error: error.name || 'InternalServerError',
        message: statusCode >= 500 
          ? 'Внутренняя ошибка сервера. Повторите попытку позже.' 
          : error.message || 'Произошла ошибка',
        statusCode,
      };

      // 🔍 Специфичная обработка ошибок валидации Zod
      if (error instanceof ZodError) {
        response.error = 'ValidationError';
        response.message = 'Ошибка валидации входных данных';
        response.statusCode = 400;
        response.details = error.issues.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));
      } 
      // 🔍 Обработка ошибок целостности PostgreSQL (через драйвер pg)
      else if ('code' in error && typeof error.code === 'string') {
        const dbCode = error.code;
        if (dbCode === '23505') {
          response.error = 'ConflictError';
          response.message = 'Ресурс с указанными уникальными параметрами уже существует';
          response.statusCode = 409;
        } else if (dbCode.startsWith('23')) {
          // Остальные constraint violations (foreign key, check, null violation)
          response.error = 'ConstraintViolationError';
          response.message = 'Нарушение целостности данных';
          response.statusCode = 400;
        } else if (dbCode.startsWith('28')) {
          // Ошибки аутентификации/авторизации БД
          response.error = 'DatabaseAccessError';
          response.message = 'Ошибка доступа к данным';
          response.statusCode = 503;
        }
      }

      // НИКОГДА не отправляем stack, sql, или внутренние метаданные клиенту
      return reply.status(response.statusCode).send(response);
    }
  );
};