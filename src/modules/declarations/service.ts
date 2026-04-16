import {pool} from '../../db/pool';
import type { declarationQueryParams } from './schema'; 

// Белый список разрешенных JOIN-ов.
// Ключи совпадают с тем, что клиент передает в query-параметре joins.
// Значения содержат безопасный SQL с алиасами таблиц.
const ALLOWED_JOINS = new Map<string,string>([
  ['dict_statuses', 'LEFT JOIN dict_statuses ds ON d.status_id = ds.id'],
  ['dict_doc_types', 'LEFT JOIN dict_doc_types dt ON d.doc_type_id = dt.id'],
  ['dict_oksm', 'LEFT JOIN dict_oksm ok ON d.product_origin_id = ok.id']
]);

export async function getDeclarations(params: declarationQueryParams) {
  const {limit, offset, sort_by, sort_order} = params;
  const conditions: string[] = [];
  const values: any[] = [];

  // Формируем условия WHERE только для переданных фильтров.
  // Каждое условие использует плейсхолдер $N, который подставляется библиотекой pg.
  if(params.applicant_inn) {
    values.push(params.applicant_inn);
    conditions.push(`d.applicant_inn = $${values.length}`);
  }
  if (params.manufacturer_inn) {
    values.push(params.manufacturer_inn);
    conditions.push(`d.manufacturer_inn = $${values.length}`);
  }
  if (params.status_id !== undefined) {
    values.push(params.status_id);
    conditions.push(`d.status_id = $${values.length}`);
  }
  if (params.doc_type_id !== undefined) {
    values.push(params.doc_type_id);
    conditions.push(`d.doc_type_id = $${values.length}`);
  }
  if (params.reg_date_from) {
    values.push(params.reg_date_from);
    conditions.push(`d.decl_reg_date >= $${values.length}`);
  }
  if (params.reg_date_to) {
    values.push(params.reg_date_to);
    conditions.push(`d.decl_reg_date <= $${values.length}`);
  }
  if (params.tnved_ids) {
    // Преобразуем строку "10,20,30" в массив PostgreSQL "{10,20,30}"
    const ids = params.tnved_ids.split(',').map(Number).filter((n) => !isNaN(n));
    if (ids.length > 0) {
      values.push(`{${ids.join(',')}}`);
      // Оператор @> проверяет, содержит ли массив в колонке все переданные значения
      conditions.push(`d.tnved_ids @> $${values.length}::int[]`);
    }
  }

  // Формируем строку WHERE. Если условий нет, она останется пустой.
  const whereClause = conditions.length? `WHERE ${conditions.join(' AND ')}` : '';

  // Собираем JOIN-ы только из разрешенного списка
  const joinClauses: string[] = [];
  if (params.joins) {
    const requested = params.joins.split(',').map((j) => j.trim());
    for (const joinKey of requested){
      const joinSql = ALLOWED_JOINS.get(joinKey);
      if (joinSql) joinClauses.push(joinSql);
    }
  }

  // Формируем список выбираемых полей динамически, только для реально подключенных JOIN-ов
  const selectedFields = [
    'd.id', 'd.card_id', 'd.decl_number', 'd.decl_reg_date', 'd.decl_end_date',
    'd.applicant_inn', 'd.manufacturer_inn', 'd.sync_status', 'd.updated_at'
  ]

  if (joinClauses.some(j => j.includes('dict_statuses'))) {
    selectedFields.push('ds.name as status_name');
  }
  if (joinClauses.some(j => j.includes('dict_doc_type'))) {
    selectedFields.push('dt.name as doc_type_name');
  }
  if (joinClauses.some(j => j.includes('dict_oksm'))) {
    selectedFields.push('ds.name as country_name');
  }

  // Оконная функция COUNT(*) OVER() возвращает общее количество записей,
  // удовлетворяющих условию WHERE, без необходимости выполнять второй запрос.
  // Алиасы ds.name, dt.name, ok.name добавляются динамически, если запрошены JOIN-ы.
  const sql = `
    SELECT
      ${selectedFields.join(', ')},
      COUNT(*) OVER() AS total_count
    FROM declarations_full d
    ${joinClauses.join(' ')}
    ${whereClause}
    ORDER BY d.${sort_by} ${sort_order}
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;

  // Выполняем запрос. Библиотека pg автоматически экранирует параметры.
  const result = await pool.query(sql, [...values, limit, offset]);

  // Извлекаем общее количество из первой строки
  const total = result.rows[0] ? Number(result.rows[0]?.total_count) : 0 ;

  // Удаляем служебное поле total_count из каждой записи перед отправкой клиенту
  const data = result.rows.map((row) => {
    const {total_count, ...rest} = row;
    return rest;
  });

  return { data, total, limit, offset };
}