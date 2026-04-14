// Импортируем типы Fastify для строгой типизации запросов, ответов и экземпляра сервера
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
// Импортируем класс ошибки Zod, который используется для валидации входных данных
import { ZodError } from 'zod';

// Описываем интерфейс для ошибок PostgreSQL.
// Библиотека pg расширяет стандартный JavaScript Error дополнительными полями,
// которые содержит база данных при возникновении проблемы (код ошибки, детали, имя таблицы и т.д.)
interface PgError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
  table?: string;
  column?: string;
}

// Экспортируем асинхронную функцию-плагин.
// В Fastify плагины принимают экземпляр сервера (fastify) в качестве аргумента.
// Это позволяет регистрировать хуки, обработчики ошибок и маршруты внутри изолированного контекста.
export async function globalErrorHandler(fastify: FastifyInstance) {
  // Регистрируем глобальный обработчик ошибок.
  // Fastify автоматически вызывает эту функцию, если в коде маршрута или middleware
  // происходит выброс исключения (throw) или возвращение отклонённого Promise.
  fastify.setErrorHandler(async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    // 1. Логирование полной информации об ошибке на стороне сервера.
    // Эти данные не отправляются клиенту в целях безопасности, но помогают разработчикам диагностировать проблему.
    // fastify.log использует встроенный логгер pino, который автоматически форматирует вывод в JSON.
    fastify.log.error(
      {
        err: error,
        reqId: request.id,
        url: request.url,
        method: request.method,
        ip: request.ip,
      },
      'Unhandled error intercepted'
    );

    // 2. Обработка ошибок валидации Zod.
    // Если схема запроса не прошла проверку, Zod выбрасывает ZodError.
    // Fastify уже перехватывает такие ошибки, но мы явно обрабатываем их здесь для единообразного формата ответа.
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: error.issues,
        },
      });
    }

    // 3. Обработка специфичных ошибок PostgreSQL.
    // Приводим общую ошибку к нашему интерфейсу PgError, чтобы получить доступ к полю code.
    const pgErr = error as PgError;
    // Проверяем, существует ли код ошибки PostgreSQL и является ли он строкой.
    if (pgErr.code && typeof pgErr.code === 'string') {
      switch (pgErr.code) {
        case '23505': // unique_violation: попытка вставить дубликат уникального поля
          return reply.code(409).send({
            error: { code: 'DUPLICATE_ENTRY', message: 'Resource already exists' },
          });
        case '23503': // foreign_key_violation: ссылка на несуществующую запись в связанной таблице
          return reply.code(400).send({
            error: { code: 'INVALID_REFERENCE', message: 'Referenced record not found' },
          });
        case '23502': // not_null_violation: попытка записать NULL в поле, где это запрещено
          return reply.code(400).send({
            error: { code: 'MISSING_FIELD', message: 'Required field is missing' },
          });
        case '22P02': // invalid_text_representation: ошибка формата данных (например, строка вместо числа)
          return reply.code(400).send({
            error: { code: 'INVALID_FORMAT', message: 'Invalid data format for field' },
          });
        case '53300': // too_many_connections: превышен лимит подключений к БД
        case '08006': // connection_failure: разрыв соединения с БД
        case '57P01': // admin_shutdown: база данных находится в процессе перезагрузки
          return reply.code(503).send({
            error: { code: 'DB_UNAVAILABLE', message: 'Database temporarily unavailable' },
          });
        default:
          // Неожиданная БД-ошибка → чистый 500
          // Если код ошибки не попал в список выше, прерываем switch и переходим к следующему блоку.
          break;
      }
    }

    // 4. Обработка исчерпания пула соединений и таймаутов.
    // Библиотека pg выбрасывает стандартные ошибки с текстовыми сообщениями при проблемах с сетью или нагрузкой.
    if (
      error.message.includes('sorry, too many clients already') ||
      error.message.includes('Operation timed out') ||
      error.message.includes('timeout expired')
    ) {
      return reply.code(503).send({
        error: {
          code: 'SERVICE_OVERLOADED',
          message: 'Service is temporarily overloaded. Please retry later.',
        },
      });
    }

    // 5. Фоллбэк: возврат универсальной ошибки 500 для всех остальных случаев.
    // Мы намеренно не отправляем stack trace или детали реализации клиенту, чтобы избежать утечки информации.
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
      },
    });
  });
}