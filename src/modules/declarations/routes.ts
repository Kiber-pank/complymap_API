import { FastifyInstance } from 'fastify';

// Плагин, содержащий маршруты для работы с декларациями.
// В Fastify каждый набор маршрутов оборачивается в функцию, принимающую экземпляр сервера.
export async function declarationsRoutes(fastify: FastifyInstance) {
  // Регистрируем обработчик GET-запроса по пути /declarations.
  // Из-за регистрации плагина с префиксом '/api' в app.ts, финальный путь будет /api/declarations.
  fastify.get('/api/declarations', async (request, reply) => {
    // Временный обработчик для проверки работы маршрута.
    // Возвращаем объект, который Fastify автоматически сериализует в JSON и отправит клиенту.
    // В дальнейшем здесь будет вызов сервиса для выборки данных из базы с применением фильтров и пагинации.
    return { message: 'Checkpoint /declarations ready', time: new Date().toISOString() };
  });
}