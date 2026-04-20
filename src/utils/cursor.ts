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
 * ТИПИЗАЦИЯ:
 * Мы используем constraint `T extends { updated_at: string | Date; id: number }`,
 * чтобы TypeScript гарантировал наличие полей курсора на уровне компиляции.
 * Это исключает небезопасные приведения `as unknown` и соответствует строгим принципам.
 * 
 * @param items - Результат запроса (должен быть длиной `limit + 1` для проверки `has_more`)
 * @param limit - Запрошенный лимит записей
 */
export function buildCursorResponse<T extends { updated_at: string | Date; id: number }>(
  items: T[],
  limit: number
): CursorResponse<T> {
  const hasMore = items.length > limit;

  if (hasMore) {
    // При стратегии LIMIT + 1 лишняя запись находится по индексу `limit` (0-based)
    const cursorItem = items[limit];
    const next_cursor = encodeCursor(cursorItem.updated_at, cursorItem.id);
    
    // Возвращаем ровно `limit` записей, отбрасывая курсорный элемент
    return { data: items.slice(0, limit), next_cursor, has_more: true };
  }

  // Дополнительных записей нет
  return { data: items, next_cursor: null, has_more: false };
}