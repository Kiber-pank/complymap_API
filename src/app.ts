import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config/env';
import { errorHandlerPlugin } from './middleware/error-handler';
import { requestIdPlugin } from './middleware/request_id';
import { declarationsRoutes } from './modules/declarations/routes';
import { certificatesRoutes } from './modules/certificates/routes';
import { checkDbHealth } from './config/db';

/**
 * Создаёт и конфигурирует экземпляр Fastify.
 * 
 * КОНЦЕПЦИИ FASTIFY:
 * 1. Порядок регистрации: хуки и декораторы (errorHandler, requestId) регистрируются 
 *    ДО маршрутов, чтобы они успели прикрепиться к контексту запроса.
 * 2. Инкапсуляция: каждый fastify.register() создаёт изолированный контекст. 
 *    Маршруты модулей не пересекаются и не делят состояния.
 * 3. trustProxy: true необходим при работе за nginx/reverse-proxy для корректного
 *    определения request.ip и заголовков X-Forwarded-*.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL
    },
    disableRequestLogging: false,
    trustProxy: true, // Важно для production-развёртывания
  });

  // Глобальные плагины
  await app.register(errorHandlerPlugin);
  await app.register(requestIdPlugin);

  // Rate Limiting Prep (In-Memory для single-node)
  // В production при кластеризации рекомендуется вынести в Redis.
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_WINDOW_MS = 60000; // 1 минута
  const RATE_LIMIT_MAX = 120; // 120 запросов в минуту с одного IP

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || 'unknown';
    const now = Date.now();
    const client = rateLimitStore.get(ip);

    if (client && now < client.resetAt) {
      client.count++;
      if (client.count > RATE_LIMIT_MAX) {
        reply.header('Retry-After', Math.ceil((client.resetAt - now) / 1000));
        return reply.status(429).send({ error: 'TooManyRequests', message: 'Превышен лимит запросов', statusCode: 429 });
      }
    } else {
      rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    }
  });

  // Health Check эндпоинт
  app.get(
    '/health',
    { logLevel: 'warn', schema: { response: { 200: { type: 'object', properties: { status: { type: 'string' }, db: { type: 'boolean' } } } } } },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const dbOk = await checkDbHealth();
      return reply.status(dbOk ? 200 : 503).send({ status: dbOk ? 'ok' : 'degraded', db: dbOk });
    }
  );

  // Регистрация доменных маршрутов
  await app.register(declarationsRoutes);
  await app.register(certificatesRoutes);

  // Graceful Shutdown хук
  app.addHook('onClose', async (instance: FastifyInstance) => {
    instance.log.info('Завершение работы Fastify, очистка внутренних состояний...');
  });

  return app;
}