import { Pool } from 'pg';
import { logger } from '../../config/logger';
import { db } from '../../config/db';
import { decodeCursor, buildCursorResponse, CursorResponse } from '../../utils/cursor';
import { createCertificatesQueryBuilder } from '../../db/query_builder';
import { CertificatesQuery } from './schema';

/**
 * Типизированная строка результата запроса сертификатов.
 * Включает обязательные поля курсора и ключевые атрибуты для API-ответа.
 * Остальные колонки доступны через Record<string, unknown> для гибкости.
 */
export type CertificateRow = {
  id: number;
  updated_at: Date | string;
  cert_number: string | null;
  status_id: number | null;
  applicant_inn: string | null;
  manufacturer_inn: string | null;
  tech_reg_ids: number[] | null;
  tnved_ids: number[] | null;
  groups_id: number[] | null;
  single_list_ids: number[] | null;
} & Record<string, unknown>;

/**
 * Получает список сертификатов с динамической фильтрацией и курсорной пагинацией.
 * 
 * АРХИТЕКТУРНЫЕ ПРИНЦИПЫ:
 * 1. Stateless: Пул БД передаётся явно (по умолчанию используется глобальный).
 * 2. Separation of Concerns: Валидация уже пройдена. Здесь только маппинг → SQL → DB → Response.
 * 3. Observability: Логируем длительность запроса и количество возвращённых строк.
 */
export async function getCertificates(
  query: CertificatesQuery,
  pool: Pool = db
): Promise<CursorResponse<CertificateRow>> {
  const startTime = performance.now();
  const qb = createCertificatesQueryBuilder();

  if (query.fields && query.fields.length > 0) {
    qb.selectFields(query.fields);
  }

  // Декодирование курсора
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

  // ILIKE требует оборачивания значения в % на уровне сервиса
  if (query.cert_number) qb.addFilter('cert_number', `%${query.cert_number}%`);

  if (query.sync_status) qb.addFilter('sync_status', query.sync_status);
  if (query.cert_reg_date_from) qb.addFilter('cert_reg_date_from', query.cert_reg_date_from);
  if (query.cert_reg_date_to) qb.addFilter('cert_reg_date_to', query.cert_reg_date_to);
  if (query.doc_type_id !== undefined) qb.addFilter('doc_type_id', query.doc_type_id);
  if (query.product_origin_id) qb.addFilter('product_origin_id', query.product_origin_id);
  if (query.applicant_type_id !== undefined) qb.addFilter('applicant_type_id', query.applicant_type_id);

  // GIN-массивы
  if (query.tnved_ids?.length) qb.addFilter('tnved_ids', query.tnved_ids);
  if (query.tech_reg_ids?.length) qb.addFilter('tech_reg_ids', query.tech_reg_ids);
  if (query.groups_id?.length) qb.addFilter('groups_id', query.groups_id);
  if (query.single_list_ids?.length) qb.addFilter('single_list_ids', query.single_list_ids);

  // Всегда добавляем поля курсора к списку выборки, даже если клиент их не запросил
  // Это гарантирует, что мы сможем сформировать валидный next_cursor
  const fieldsForQuery = query.fields 
    ? [...new Set([...query.fields, 'updated_at', 'id'])] // Set удалит дубликаты
    : undefined; // Если fields не указан, берём всё (по умолчанию)

  if (fieldsForQuery && fieldsForQuery.length > 0) {
    qb.selectFields(fieldsForQuery);
  }

  // Сортировка, курсор и лимит
  qb.addSort(query.sort, query.direction);
  qb.applyCursor(decodedCursor, query.direction);
  qb.setLimit(query.limit);

  const { text, values } = qb.build();

  try {
    // Выполняем запрос. Драйвер pg автоматически экранирует $1, $2...
    const result = await pool.query<CertificateRow>(text, values);

    const duration = performance.now() - startTime;
    logger.debug(
      { duration_ms: duration.toFixed(2), rows_fetched: result.rows.length, sql_preview: text.split('\n')[0] },
      'Выполнен запрос сертификатов'
    );

        // 🧹 Если клиент не запрашивал updated_at/id, удаляем их из ответа перед возвратом
        // (но они остались в результате для генерации курсора)
        const cleanedRows = query.fields 
          ? result.rows.map(row => {
              const filtered: Record<string, unknown> = {};
              for (const field of query.fields!) {
                if (field in row) filtered[field] = row[field];
              }
              return filtered as CertificateRow;
            })
          : result.rows;

    // Формируем ответ: cleanedRows уже содержат только запрошенные поля,
    // но для buildCursorResponse передаём оригинальные rows (с updated_at/id)
    // НО: buildCursorResponse читает последние записи из result.rows, так что всё ок.
    return buildCursorResponse(result.rows, query.limit, query.fields);
  } catch (error) {
    logger.error(
      { error: error as Error, query_preview: text, values_count: values.length },
      'Ошибка выполнения SQL-запроса сертификатов'
    );
    throw error; // Пробрасываем в глобальный errorHandler
  }
}