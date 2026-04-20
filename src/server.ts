import 'dotenv/config';
import { buildApp } from './app';
import { config } from './config/env';
import { closeDbPool, checkDbHealth } from './config/db';
import { logger } from './config/logger';

/**
 * Точка входа приложения.
 * 
 * КОНЦЕПЦИИ FASTIFY & NODE.JS:
 * 1. app.listen() возвращает Promise, который резолвится только после успешного биндинга порта.
 * 2. process.on('SIGTERM'/'SIGINT') перехватывает сигналы от PM2, systemd или оркестратора.
 * 3. Graceful shutdown: сначала останавливаем приём новых запросов (app.close()), 
 *    затем ждём завершения активных транзакций, и только потом закрываем пул БД.
 *    Это предотвращает 502/504 ошибки при перезапуске.
 */
async function start() {
  const app = await buildApp();

  try {
    // Fail-Fast проверка БД до открытия порта
    const isDbReady = await checkDbHealth();
    if (!isDbReady) {
      throw new Error('PostgreSQL недоступен при старте');
    }

    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Сервер запущен и готов принимать запросы');
  } catch (err) {
    logger.fatal({ err: err as Error }, 'Не удалось запустить сервер');
    process.exit(1);
  }

  // Обработка сигналов завершения ОС
  const shutdown = async (signal: string) => {
    logger.warn({ signal }, 'Получен сигнал завершения, начинаем graceful shutdown...');
    try {
      // 1. Останавливаем Fastify (вызывает хук onClose, прекращает приём новых запросов)
      await app.close();
      // 2. Закрываем пул соединений PostgreSQL
      await closeDbPool();
      logger.info('Сервер корректно остановлен');
      process.exit(0);
    } catch (err) {
      logger.error({ err: err as Error }, 'Ошибка при graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Запуск
start();