import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { declarationQueryParams, declarationQuerySchema } from './schema';
import { getDeclarations } from './service';
import { request } from 'node:http';
import { object } from 'zod';

// Плагин, содержащий маршруты для работы с декларациями.
// В Fastify каждый набор маршрутов оборачивается в функцию, принимающую экземпляр сервера.

export async function declarationsRoutes(fastify: FastifyInstance) {
  // fastify.get принимает три аргумента: путь, конфигурация (включая схему), обработчик
  // Путь указан как '/declarations', так как в app.ts плагин регистрируется с префиксом '/api'.
  // Итоговый маршрут: GET /api/declarations
  fastify.get(
    '/declarations',
    {
      schema: {
        // Указываем Zod-схему для querystring. Fastify передаст её в наш кастомный компилятор.
        // Валидация query-параметров через Zod. Ошибки перехватываются глобальным обработчиком.
        querystring: declarationQuerySchema,
        // Валидация query-параметров через Zod. Ошибки перехватываются глобальным обработчиком.
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: { type: 'object', additionalProperties: true}
              },
              total: {type: 'number'},
              limit: {type: 'number'},
              offset: {type: 'number'}
            }
          }
        }
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