import { Pool } from 'pg';
import { logger } from '../../config/logger';
import { db } from '../../config/db';
import { decodeCursor, buildCursorResponse, CursorResponse } from '../../utils/cursor';
import { createDeclarationsQueryBuilder } from '../../db/query_builder';
import { DeclarationsQuery } from './schema';

/**
 * Типизированная строка результата запроса.
 * Включает обязательные поля курсора и основные атрибуты декларации.
 * Остальные поля доступны через Record<string, unknown> для гибкости.
 */
export type DeclarationRow = {
  id: number;
  updated_at: Date | string;
  decl_number: string | null;
  status_id: number | null;
  applicant_inn: string | null;
  manufacturer_inn: string | null;
  tech_reg_ids: number[] | null;
  tnved_ids: number[] | null;
  groups_id: number[] | null;
  single_list_ids: number[] | null;
} & Record<string, unknown>;

/**
 * Получает список деклараций с динамической фильтрацией и курсорной пагинацией.
 * 
 * АРХИТЕКТУРНЫЕ ПРИНЦИПЫ:
 * 1. Stateless: Сервис не хранит состояние. Пул БД передаётся явно (по дефолту используется глобальный).
 * 2. Separation of Concerns: Валидация уже отработала в Fastify. Здесь только маппинг -> SQL -> DB -> Response.
 * 3. Observability: Логируем длительность SQL и параметры запроса (без чувствительных данных).
 */
export async function getDeclarations(
  query: DeclarationsQuery,
  pool: Pool = db
): Promise<CursorResponse<DeclarationRow>> {
  const startTime = performance.now();
  const qb = createDeclarationsQueryBuilder();

  if (query.fields && query.fields.length > 0) {
    qb.selectFields(query.fields);
  }
  
  // Декодирование курсора (если присутствует)
  let decodedCursor = null;
  if (query.cursor) {
    // Zod уже проверил формат строки, но decodeCursor дополнительно валидирует структуру
    decodedCursor = decodeCursor(query.cursor);
  }

  // Применение фильтров (только те, что переданы клиентом)
  // Строго соответствуем allowlist: если поле undefined -> оно не попадает в WHERE
  if (query.status_id !== undefined) qb.addFilter('status_id', query.status_id);
  if (query.applicant_inn) qb.addFilter('applicant_inn', query.applicant_inn);
  if (query.manufacturer_inn) qb.addFilter('manufacturer_inn', query.manufacturer_inn);

  // Для ILIKE оборачиваем значение в проценты на уровне сервиса, чтобы билдер не знал о специфике оператора
  if (query.decl_number) qb.addFilter('decl_number', `%${query.decl_number}%`);

  if (query.sync_status) qb.addFilter('sync_status', query.sync_status);
  if (query.decl_reg_date_from) qb.addFilter('decl_reg_date_from', query.decl_reg_date_from);
  if (query.decl_reg_date_to) qb.addFilter('decl_reg_date_to', query.decl_reg_date_to);
  if (query.doc_type_id !== undefined) qb.addFilter('doc_type_id', query.doc_type_id);
  if (query.product_origin_id) qb.addFilter('product_origin_id', query.product_origin_id);
  if (query.applicant_type_id !== undefined) qb.addFilter('applicant_type_id', query.applicant_type_id);

  // Массивные фильтры (используют GIN &&)
  if (query.tnved_ids?.length) qb.addFilter('tnved_ids', query.tnved_ids);
  if (query.tech_reg_ids?.length) qb.addFilter('tech_reg_ids', query.tech_reg_ids);
  if (query.groups_id?.length) qb.addFilter('groups_id', query.groups_id);
  if (query.single_list_ids?.length) qb.addFilter('single_list_ids', query.single_list_ids);

  // Сортировка, курсор и лимит
  qb.addSort(query.sort, query.direction);
  qb.applyCursor(decodedCursor, query.direction);
  qb.setLimit(query.limit);

  const { text, values } = qb.build();

  try {
    // Выполняем запрос. Драйвер pg автоматически экранирует $1, $2...
    const result = await pool.query<DeclarationRow>(text, values);

    const duration = performance.now() - startTime;
    // Логируем только время и превью SQL для отладки планировщика
    logger.debug(
      { duration_ms: duration.toFixed(2), rows_fetched: result.rows.length, sql_preview: text.split('\n')[0] },
      'Выполнен запрос деклараций'
    );

    // Формируем ответ: отсекаем лишнюю (N+1) запись, кодируем курсор, вычисляем has_more
    return buildCursorResponse(result.rows, query.limit);
  } catch (error) {
    logger.error(
      { error: error as Error, query_preview: text, values_count: values.length },
      'Ошибка выполнения SQL-запроса деклараций'
    );
    // Пробрасываем дальше -> ловится глобальным errorHandler
    throw error;
  }
}