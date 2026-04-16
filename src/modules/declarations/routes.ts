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
        querystring: {
          type: 'object',
          properties: {
            // Пагинация: преобразуется из строки в число, от 1 до 100, по умолчанию 20
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 5,
              description: 'Количество записей на странице'
            },
            // Курсор: положительное целое число (ID последней записи), опционально
            cursor: {
              type: 'integer',
              minimum: 1,
              description: 'ID последней записи с предыдущей страницы для пагинации'
            },
            // Порядок сортировки: только 'ASC' или 'DESC', по умолчанию 'DESC'
            sort_order: {
              type: 'string',
              enum: ['ASC', 'DESC'],
              default: 'DESC',
              description: 'Направление сортировки по полю id'
            },
            // Фильтры по строковым полям (ИНН)
            applicant_inn: {
              type: 'string',
              description: 'Фильтр по ИНН заявителя'
            },
            manufacturer_inn: {
              type: 'string',
              description: 'Фильтр по ИНН производителя'
            },
            // Фильтры по числовым полям (справочники)
            status_id: {
              type: 'integer',
              description: 'ID статуса из справочника dict_statuses'
            },
            doc_type_id: {
              type: 'integer',
              description: 'ID типа документа из справочника dict_doc_types'
            },
            // Фильтры по диапазону дат (формат YYYY-MM-DD)
            reg_date_from: {
              type: 'string',
              format: 'date',
              description: 'Начальная дата диапазона регистрации (формат: YYYY-MM-DD)'
            },
            reg_date_to: {
              type: 'string',
              format: 'date',
              description: 'Конечная дата диапазона регистрации (формат: YYYY-MM-DD)'
            },
            // Массив ТН ВЭД передаётся как строка "123,456,789"
            tnved_ids: {
              type: 'string',
              description: 'Список ID ТН ВЭД через запятую (например: "123,456,789")'
            },
            // JOIN-ы передаются как строка "dict_statuses,dict_doc_types"
            joins: {
              type: 'string',
              description: 'Список справочников для JOIN через запятую (например: "dict_statuses,dict_doc_types")'
            }
          },
          // Все поля опциональны: либо имеют default, либо .optional()
          required: []
        },
        // Валидация query-параметров через Zod. Ошибки перехватываются глобальным обработчиком.
        response: {
          200: {
            type: 'object',
            description: 'Успешный ответ с пагинацией курсором',
            properties: {
              data: {
                type: 'array',
                description: 'Массив записей деклараций',
                items: {
                  type: 'object',
                  description: 'Запись декларации. Поля могут дополняться в зависимости от параметра joins',
                  properties: {
                    // Базовые поля, которые возвращаются всегда
                    id: { type: 'integer', description: 'Внутренний ID записи' },
                    card_id: { type: 'string', description: 'ID декларации на портале ФСА' },
                    decl_number: { type: 'string', description: 'Номер декларации' },
                    decl_reg_date: { type: 'string', format: 'date-time', description: 'Дата регистрации' },
                    decl_end_date: { type: 'string', format: 'date-time', description: 'Дата окончания действия' },
                    applicant_inn: { type: 'string', description: 'ИНН заявителя' },
                    manufacturer_inn: { type: 'string', description: 'ИНН производителя' },
                    sync_status: { type: 'string', description: 'Статус синхронизации' },
                    updated_at: { type: 'string', format: 'date-time', description: 'Дата последнего обновления' }
                  },
                  // Разрешаем любые дополнительные поля из JOIN-ов (ds.name, dt.name, ok.name и т.д.)
                  additionalProperties: true
                }
              },
              nextCursor: {
                type: ['integer', 'null'],
                description: 'ID последней записи в текущей выдаче для запроса следующей страницы',
                nullable: true
              },
              hasMore: {
                type: 'boolean',
                description: 'Есть ли ещё записи после текущей страницы'
              },
              limit: {
                type: 'integer',
                description: 'Запрошенное количество записей на странице'
              }
            },
            // Пример ответа для отображения в Swagger UI
            example: {
              data: [
                {
                  id: 1859164,
                  card_id: '21334152',
                  decl_number: 'РОСС RU Д-RU.РА01.В.11940/26',
                  decl_reg_date: '2026-04-15T21:00:00.000Z',
                  decl_end_date: '2031-04-15T21:00:00.000Z',
                  applicant_inn: '0278982776',
                  manufacturer_inn: '0278982776',
                  sync_status: 'success',
                  updated_at: '2026-04-16T15:16:06.476Z'
                }
              ],
              nextCursor: 1859160,
              hasMore: true,
              limit: 5
            }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof declarationQuerySchema> }>,
      reply: FastifyReply
    ) => {
      const result = await getDeclarations(request.query);
      return reply.send(result);
    }
  );
}