import Fastify, { FastifySchemaCompiler, FastifySchema } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';

import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/healt';
import { declarationsRoutes } from './modules/declarations/routes';
import { globalErrorHandler } from './plugins/error-handler';

// Экспортируем фабричную функцию для создания приложения.
// Это позволяет легко тестировать сервер, не запуская реальный HTTP-порт.
export async function buildApp() {

  // Создаём базовый экземпляр Fastify.
  // logger: true включает встроенный логгер (pino). В продакшене его можно настроить на JSON-вывод.
  const fastify = Fastify({ logger: true });

  // Порядок регистрации плагинов важен.
  // Сначала регистрируем обработчик ошибок, чтобы он мог перехватывать исключения из всех последующих плагинов.
  await fastify.register(globalErrorHandler);

  // Регистрируем плагин ограничения частоты запросов (Rate Limiting).
  // Защищает сервер от DDoS и исчерпания ресурсов пула подключений к базе данных.
  await fastify.register(rateLimit, {
    max: 100,                //максимум запросов
    timeWindow: '1 minute', //за какой период
    keyGenerator: (req) => req.ip, // для авторизовыанных клиентов  req.headers['x_api-key']
    errorResponseBuilder: (req, context) => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many request. Retly after ${Math.ceil(context.ttl / 1000)}s`,
        limit: context.max,
        remaining: 0
      }
    }),

    // Добавляем HTTP-заголовки в каждый ответ, чтобы клиент видел свой текущий лимит.
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true
    }
  })

  // Регистрируем маршрут проверки работоспособности сервиса.
  await fastify.register(healthRoutes);

  // Включаем CORS (Cross-Origin Resource Sharing).
  // origin: true разрешает запросы с любых доменов. В продакшене следует указать конкретные домены фронтенда.
  await fastify.register(cors, { origin: true });

  // Регистрируем генератор OpenAPI-спецификации
  // Здесь передаются только настройки самой спецификации (информация об API, версии, серверы и т.д.)
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'complymap API',
        description: 'API для работы с реестрами деклараций и сертификатов',
        version: '0.1.0'
      },
      servers: [{ url: `http://localhost:${process.env.PORT || 3000}` }]
    },
  });

  // Регистрируем Swagger UI для отображения документации
  // exposeRoute: true — делает спецификацию доступной по /documentation/json и включает UI в продакшене
  // В реальном продакшене лучше вынести это в переменную окружения и включать только для staging/dev
  await fastify.register(swaggerUI, {
    routePrefix: '/docs', // URL, по которому будет доступен Swagger UI
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Регистрируем маршруты бизнес-логики.
  // prefix: '/api' добавляет префикс ко всем путям внутри этого плагина.
  // Например, маршрут '/declarations' станет доступен по адресу '/api/declarations'.
  fastify.register(declarationsRoutes, { prefix: '/api' });

  // Возвращаем готовый экземпляр приложения для запуска в server.ts.
  return fastify;
}