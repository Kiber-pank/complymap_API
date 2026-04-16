import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';

// Плагин с маршрутом проверки здоровья сервиса.
export async function healthRoutes(fastify: FastifyInstance) {

  // Регистрируем GET-обработчик по пути /health.
  // logLevel: 'warn' подавляет логирование каждого успешного запроса к этому эндпоинту,
  // так как мониторинг опрашивает его каждые 10-30 секунд, и логи быстро раздуваются.
  fastify.get('/health', { logLevel: 'warn' }, async (request, reply) => {
    try {
      // Выполняем минимально затратный запрос к базе данных для проверки соединения.
      // SELECT 1 не требует доступа к таблицам, но гарантирует, что пул соединений работает и база отвечает.
      await pool.query('SELECT 1');
      // Возвращаем JSON-объект со статусом 200 OK.
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        db: 'connected',
        uptime: process.uptime()
      };
    } catch (err) {
      // Логируем ошибку только в случае сбоя, чтобы не засорять логи успешными проверками.
      request.log.error({ err }, 'Healthcheck failed');

      // Устанавливаем HTTP-статус 503 (Service Unavailable) перед отправкой ответа.
      reply.code(503);

      // Возвращаем информацию о деградации сервиса.
      // Балансировщики нагрузки или оркестраторы используют этот ответ для вывода инстанса из ротации.
      return {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        db: 'unreachable',
        message: 'Database connection failed'
      };
    }
  });
}