import {z} from 'zod';

export const declarationQuerySchema = z.object({
  // Пагинация: limit от 1 до 100, offset не меньше 0
  // z.coerce.number() автоматически преобразует строку "20" в число 20
  limit: z.coerce.number().int().min(1).max(100).default(20),
  //offset: z.coerce.number().int().min(0).default(0),

  // Курсор принимает ID последней записи, которую клиент получил на предыдущем шаге.
  // При первом запросе параметр отсутствует, сервер вернёт самые свежие записи.
  cursor: z.coerce.number().int().positive().optional(),
  
  // Сортировка: разрешаем только явно указанные поля (защита от инъекций в ORDER BY)
  //sort_by: z.enum(['id', 'decl_number', 'decl_reg_date', 'update_at']).default('id'),
  sort_order: z.enum(['ASC', 'DESC']).default('DESC'),

  // Фильтры по строкам
  applicant_inn: z.string().optional(),
  manufacturer_inn: z.string().optional(),

  // Фильтры по числам (связанные справочники)
  status_id: z.coerce.number().int().optional(),
  doc_type_id: z.coerce.number().int().optional(),

  // Фильтры по диапазону дат
  reg_date_from: z.iso.date().optional(),
  reg_date_to: z.iso.date().optional(),

  // Массив ID ТН ВЭД: придет как строка "123,456,789". Распарсим в сервисе.
  tnved_ids: z.string().optional(),

  // JOIN-ы: клиент перечисляет через запятую, какие справочники нужно подтянуть
  joins: z.string().optional()
});

// Автоматически выводим TypeScript-тип из схемы
export type declarationQueryParams = z.infer<typeof declarationQuerySchema>;