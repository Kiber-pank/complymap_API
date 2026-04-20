import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

/**
 * Расширяем тип FastifyRequest, чтобы TypeScript знал о поле requestId.
 * Это стандартный паттерн в Fastify для безопасного декорирования запросов.
 */
declare module 'fastify' {
  interface FastifyRequest {
    /** Уникальный идентификатор HTTP-запроса (UUID v4) */
    requestId: string;
  }
}

/**
 * Fastify-плагин для генерации и привязки request_id.
 * 
 * ПОЧЕМУ ПЛАГИН, А НЕ ОБЫЧНЫЙ MIDDLEWARE:
 * Fastify использует строгую инкапсуляцию. Хуки, зарегистрированные через
 * fastify.addHook() внутри плагина, автоматически наследуются всеми дочерними маршрутами,
 * если плагин подключён в корне приложения.
 * 
 * МЕХАНИКА:
 * 1. onRequest срабатывает до валидации и роутинга.
 * 2. Генерируем UUID.
 * 3. Вызываем request.log.child({ request_id }), чтобы ВСЕ последующие логи
 *    (валидация, DB-запросы, ошибки) автоматически содержали этот ID.
 */
export const requestIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', (request, _reply, done) => {
    request.requestId = randomUUID();
    
    // Перенаправляем логгер запроса. Fastify использует child-логгеры,
    // поэтому контекст не теряется при вложенных вызовах.
    request.log = request.log.child({ request_id: request.requestId });
    
    done();
  });
};