import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { declarationQueryParams, declarationQuerySchema } from './schema';
import { getDeclarations } from './service';
import { request } from 'node:http';

// Плагин, содержащий маршруты для работы с декларациями.
// В Fastify каждый набор маршрутов оборачивается в функцию, принимающую экземпляр сервера.

export async function declarationsRoutes(fastify: FastifyInstance) {
  // fastify.get принимает три аргумента: путь, конфигурация (включая схему), обработчик
  fastify.get(
    '/api/declarations',
    {
      schema: {
        // Указываем Zod-схему для querystring. Fastify передаст её в наш кастомный компилятор.
        querystring: declarationQuerySchema
      }
    },
    async (
      request: FastifyRequest<{Querystring: declarationQueryParams}>,
      reply: FastifyReply
    ) => {
      const result = await getDeclarations(request.query);
      return reply.send(result);
    }
  );
}