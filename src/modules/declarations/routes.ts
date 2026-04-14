import { FastifyInstance } from 'fastify';

export async function declarationsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/declarations', async (request, reply) => {
    return { message: 'Checkpoint /declarations ready', time: new Date().toISOString() };
  });
}