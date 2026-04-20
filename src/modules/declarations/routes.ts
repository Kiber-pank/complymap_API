import { FastifyPluginAsync } from 'fastify';
import { declarationsQuerySchema, DeclarationsQuery } from './schema';
import { getDeclarations } from './service';

export const declarationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/v1/declarations',
    {
      logLevel: 'info'
    },
    async (request, reply) => {
      // .parse() применяет все .default(), .coerce() и трансформеры.
      // Если валидация не пройдена — бросит ZodError, который автоматически 
      // будет пойман глобальным setErrorHandler и вернёт 400.
      const query = declarationsQuerySchema.parse(request.query as Record<string, unknown>);

      request.log.info({ filters_count: Object.keys(query).length }, 'Запрос списка деклараций');

      const result = await getDeclarations(query);
      return reply.send(result);
    }
  );
};