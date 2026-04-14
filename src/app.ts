import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { declarationsRoutes } from './modules/declarations/routes';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });
  await fastify.register(swagger, {
    openapi: { info: { title: 'FSA API', version: '0.1.0' } },
  });
  await fastify.register(swaggerUI, { routePrefix: '/docs' });

  fastify.register(declarationsRoutes);

  return fastify;
}