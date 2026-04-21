import { z } from 'zod';

/**
 * Вспомогательный трансформер для безопасного преобразования CSV-строк или массивов строк 
 * в массив целых положительных чисел.
 * 
 * ПОЧЕМУ ТАК:
 * - Swagger UI при `explode: false` может отправлять как строку "1,2", так и массив ["1","2"]
 * - Этот препроцессор унифицирует оба формата и конвертирует значения в числа ДО валидации
 * - Отфильтровывает NaN и неположительные значения на раннем этапе
 */
const parseIntArray = z.preprocess(
  (val) => {
    let rawValues: unknown[];
    
    // Нормализуем вход: приводим к массиву значений
    if (Array.isArray(val)) {
      rawValues = val;
    } else if (typeof val === 'string') {
      rawValues = val.split(',');
    } else {
      return val; // Пусть Zod выбросит ошибку на следующем этапе
    }
    
    // Конвертируем каждое значение в число, фильтруем невалидные
    return rawValues
      .map(v => {
        const num = Number(v);
        return Number.isNaN(num) ? undefined : num;
      })
      .filter((n): n is number => n !== undefined && Number.isInteger(n) && n > 0);
  },
  // После препроцессинга у нас уже гарантированно массив чисел — валидируем структуру
  z.array(z.number().int().positive())
);

const parseCsvFields = z.preprocess(
  (val) => {
    if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
    return Array.isArray(val) ? val : [];
  },
  z.array(z.string().min(1).max(50)).min(1).max(20) // Мин 1, Макс 20 полей за запрос
);

/**
 * Строгая схема валидации query-параметров для /api/v1/declarations.
 * Все поля опциональны, кроме `cursor` и `limit` (имеют дефолты).
 * Соответствует allowlist-конфигурации в QueryBuilder.
 */
export const declarationsQuerySchema = z.object({
  cursor: z.string().optional().describe('Base64-строка курсора для пагинации'),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe('Количество записей на странице'),
  sort: z.enum(['updated_at', 'decl_reg_date', 'decl_end_date', 'decl_number']).default('updated_at'),
  direction: z.enum(['ASC', 'DESC']).default('DESC'),
  
  // Скалярные фильтры
  status_id: z.coerce.number().int().positive().optional(),
  applicant_inn: z.string().regex(/^\d{10,12}$/, 'INN должен содержать 10 или 12 цифр').optional(),
  manufacturer_inn: z.string().regex(/^\d{10,12}$/, 'INN должен содержать 10 или 12 цифр').optional(),
  decl_number: z.string().max(100).optional(),
  sync_status: z.enum(['success', 'not_found', 'error']).optional(),
  doc_type_id: z.coerce.number().int().positive().optional(),
  product_origin_id: z.string().max(20).optional(),
  applicant_type_id: z.coerce.number().int().positive().optional(),
  
  // Диапазоны дат (коэрцитивно приводятся к Date или отклоняются)
  decl_reg_date_from: z.coerce.date().optional(),
  decl_reg_date_to: z.coerce.date().optional(),
  
  // Массивные фильтры (используют GIN-индексы и оператор &&)
  tnved_ids: parseIntArray.optional(),
  tech_reg_ids: parseIntArray.optional(),
  groups_id: parseIntArray.optional(),
  single_list_ids: parseIntArray.optional(),
  fields: parseCsvFields.optional().describe('Список возвращаемых полей через запятую (пример: id,decl_number,status_name)'),
});

export type DeclarationsQuery = z.infer<typeof declarationsQuerySchema>;