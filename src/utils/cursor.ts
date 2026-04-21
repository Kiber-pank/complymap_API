import { z } from 'zod';

/**
 * Стандартный интерфейс ответа с курсорной пагинацией.
 * Используется всеми сервисами, возвращающими коллекции записей.
 */
export interface CursorResponse<T = unknown> {
  /** Массив данных (ровно `limit` записей) */
  data: T[];
  /**
   * Строка курсора для следующего запроса.
   * null, если достигнут конец выборки.
   */
  next_cursor: string | null;
  /**
   * Флаг наличия дополнительных записей после текущей страницы.
   */
  has_more: boolean;
}

/**
 * Внутренняя схема валидации структуры декодированного курсора.
 */
const cursorSchema = z.object({
  updated_at: z.string(), // ISO 8601
  id: z.number().int().positive(),
});

/**
 * Кодирует метку времени и внутренний ID в непрозрачную строку курсора (Base64).
 * 
 * ПОЧЕМУ BASE64:
 * 1. Скрывает внутреннюю структуру БД от клиента.
 * 2. Гарантирует безопасную передачу через URL (Fastify автоматически парсит query-params).
 * 3. Минимальный оверхед. Криптографическая подпись не нужна, т.к. валидация происходит на сервере.
 */
export function encodeCursor(updatedAt: Date | string, id: number): string {
  const payload = {
    updated_at: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
    id,
  };
  
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Декодирует строку курсора, валидирует через Zod и возвращает типизированный объект.
 * 
 * ВАЖНО:
 * Валидация происходит ДО передачи в SQL. Это предотвращает SQL-инъекции и ошибки типов.
 * При невалидном курсе бросается Error, который перехватывается errorHandler и преобразуется в 400.
 */
export function decodeCursor(cursor: string): { updated_at: string; id: number } {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    
    const result = cursorSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Структура курсора нарушена: ${result.error.message}`);
    }
    
    return result.data;
  } catch (error) {
    throw new Error(`Невалидный формат курсора: ${(error as Error).message}`);
  }
}

/**
 * Вспомогательная функция для формирования пагинированного ответа.
 * 
 *  * Добавлен параметр `requestedFields`, чтобы корректно фильтровать ответ,
 * но при этом всегда формировать курсор из полных данных (с updated_at/id).
 * 
 * @param items - Результат запроса (должен быть длиной `limit + 1` для проверки `has_more`)
 * @param limit - Запрошенный лимит записей
 * @param requestedFields - Опциональный список полей, запрошенных клиентом (?fields=...)
 */
export function buildCursorResponse<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  requestedFields?: string[]
): CursorResponse<T> {
  const hasMore = items.length > limit;
  let next_cursor: string | null = null;

  // 🛡️ Формируем курсор ВСЕГДА из полных данных (даже если клиент не запрашивал эти поля)
  // Это возможно, потому что в сервисе мы принудительно добавляем updated_at/id в SELECT
  if (hasMore) {
    const cursorItem = items[limit];
    
    // Безопасное извлечение полей курсора с проверкой типов
    const updatedAt = cursorItem['updated_at'];
    const id = cursorItem['id'];
    
    if (updatedAt && id) {
      next_cursor = encodeCursor(
        updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
        typeof id === 'number' ? id : Number(id)
      );
    }
  }

  // 🧹 Если клиент запросил конкретные поля, фильтруем ответ
  // (но курсор уже сформирован из полных данных выше)
  const data = requestedFields && requestedFields.length > 0
    ? items.slice(0, limit).map(row => {
        const filtered: Record<string, unknown> = {};
        for (const field of requestedFields) {
          if (field in row) {
            filtered[field] = row[field];
          }
        }
        return filtered as T;
      })
    : items.slice(0, limit) as T[];

  return {
    data,
    next_cursor,
    has_more: hasMore,
  };
}