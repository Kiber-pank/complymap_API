import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { declarationQuerySchema } from './schema';
import { getDeclarations } from './service';


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
              nextCursor: {type: ['number', 'null']},
              hasMore: { type: 'boolean'},
              limit: {type: 'number'}
            }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{Querystring: z.infer<typeof declarationQuerySchema>}>,
      reply: FastifyReply
    ) => {
      const result = await getDeclarations(request.query);
      console.log("result.data: ", result.data);
      return reply.send(result);
    }
  );
}