import { FastifyPluginAsync } from 'fastify';
import { certificatesQuerySchema, CertificatesQuery } from './schema';
import { getCertificates } from './service';

export const certificatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/v1/certificates',
    {
      logLevel: 'info'
    },
    async (request, reply) => {
      // ✅ Безопасный парсинг с применением дефолтов и трансформаций
      const query = certificatesQuerySchema.parse(request.query as Record<string, unknown>);

      request.log.info({ filters_count: Object.keys(query).length }, 'Запрос списка сертификатов');

      const result = await getCertificates(query);
      return reply.send(result);
    }
  );
};