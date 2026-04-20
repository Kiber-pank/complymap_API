import { Pool } from 'pg';
import { config } from './env';

/**
 * Создаём пул соединений PostgreSQL.
 * Пул переиспользует активные соединения, что критически важно для Node.js:
 * создание нового TCP-соединения на каждый запрос упрётся в лимиты БД и
 * значительно увеличит latency.
 */
const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  max: config.DB_MAX_CONNECTIONS,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  // Таймаут установки соединения (защита от "зависших" попыток подключения)
  connectionTimeoutMillis: 10000
});

/**
 * Проверяет доступность БД.
 * Используется при старте сервера и в эндпоинте /health.
 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('PostgreSQL недоступен:', (error as Error).message);
    return false;
  }
}

/**
 * Graceful shutdown пула.
 * Ждёт завершения активных транзакций, затем закрывает все соединения.
 * Вызывается в обработчиках сигналов SIGTERM/SIGINT.
 */
export async function closeDbPool(): Promise<void> {
  await pool.end();
}

/**
 * Экспортируем инстанс пула для инъекции в сервисы.
 * Мы не оборачиваем его в класс или DI-контейнер: в Fastify достаточно
 * передавать пул через декораторы или аргументы плагинов. Это сохраняет
  * функциональную чистоту и упрощает юнит-тестирование.
 */
export const db = pool;