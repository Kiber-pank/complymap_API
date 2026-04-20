import pino from 'pino';
import { config } from './env';

/**
 * Экспортируем инстанс логгера.
 * 
 * 🔧 FIX: Конфигурация транспорта встроена напрямую через условный спред (...).
 * Это исключает ошибки "Cannot find name" и полностью удовлетворяет strictNullChecks.
 * - В development: добавляется pino-pretty для цветного вывода.
 * - В production: спред пустого объекта {} не добавляет ключ transport, 
 *   что соответствует требованиям Pino для отправки чистого JSON.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});