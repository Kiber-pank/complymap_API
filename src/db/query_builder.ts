/**
 * Универсальный построитель безопасных SQL-запросов.
 * 
 * АРХИТЕКТУРНЫЕ ПРИНЦИПЫ:
 * 1. Строгая параметризация: Все значения передаются через $1, $2... драйвер pg сам 
 *    экранирует их и защищает от SQL-инъекций.
 * 2. Allowlist-подход: Разрешены только явно описанные поля фильтрации, сортировки и JOIN-ы.
 *    Это предотвращает подбор колонок (column enumeration) и использование неиндексированных полей.
 * 3. Поддержка GIN-индексов: Операторы @> (содержит) и && (пересечение) для integer[] 
 *    гарантируют использование индексов `idx_*_tnved_ids`, `idx_*_tech_reg_ids` и т.д.
 * 4. Курсорная стабильность: Автоматическое добавение (updated_at, id) < / > (...) 
 *    гарантирует детерминированный порядок выдачи при параллельных UPDATE.
 */

// Допустимые операторы фильтрации
type FilterOperator = '=' | 'ILIKE' | '>=' | '<=' | '@>' | '&&';


export interface FieldConfig {
  /** Полная ссылка на колонку: 'main.col' или 'dict_alias.col' */
  dbRef: string;
  /** Ключ из allowedJoins, который нужно подключить для этого поля */
  joinKey?: string;
}

/** Конфигурация одного допустимого поля фильтрации */
export interface FilterConfig {
  /** Имя колонки в БД */
  column: string;
  /** Оператор сравнения */
  operator: FilterOperator;
  /** Приведение типа параметра (опционально). Например 'int[]' для GIN-запросов */
  cast?: string;
}

/** Конфигурация допустимого LEFT JOIN к справочнику */
export interface JoinConfig {
  /** Имя таблицы справочника */
  table: string;
  /** Алиас таблицы в запросе */
  alias: string;
  /** Условие соединения (полностью qualified: main.col = dict.col) */
  on: string;
}

/** Полная конфигурация построителя для конкретной сущности */
export interface QueryBuilderConfig {
  /** Основная таблица */
  mainTable: string;
  /** Алиас основной таблицы (например, 'd') */
  mainAlias: string;
  /** Колонка для курсора (обычно updated_at) */
  cursorColumn: string;
  /** Первичный ключ (обычно id) */
  primaryKey: string;
  /** Карта разрешённых фильтров */
  allowedFilters: Record<string, FilterConfig>;
  /** Карта разрешённых сортировок */
  allowedSorts: Record<string, string>;
  /** Карта разрешённых JOIN-ов */
  allowedJoins: Record<string, JoinConfig>;
  /** Маппинг клиентских имён полей на колонки БД и справочники */
  allowedFields: Record<string, FieldConfig>;
}

/** Результат работы построителя: готовый SQL и массив параметров */
export interface QueryResult {
  text: string;
  values: unknown[];
}

/**
 * Класс SafeQueryBuilder.
 * Использует функциональный подход к сборке: методы мутируют внутреннее состояние, 
 * но строго валидируют входные данные на каждом шаге.
 */
export class SafeQueryBuilder {
  private readonly config: QueryBuilderConfig;
  private readonly conditions: string[] = [];
  private readonly joins: string[] = [];
  private readonly orderClauses: string[] = [];
  private readonly values: unknown[] = [];
  private limit: number = 21; // По умолчанию 20 + 1 для расчёта has_more
  private selectedFields: string[] | null = null;
  private readonly addedJoins = new Set<string>(); // Защита от дублей JOIN

  constructor(config: QueryBuilderConfig) {
    this.config = config;
  }

  /**
   * Добавляет условие WHERE из allowlist.
   * Значение `value` никогда не подставляется в строку SQL.
   */
  addFilter(field: string, value: unknown): this {
    const filter = this.config.allowedFilters[field];
    if (!filter) {
      // В production это должен быть 400 Bad Request, ловится валидатором, 
      // здесь выбрасываем для отладки на этапе сборки.
      throw new Error(`Поле фильтрации "${field}" отсутствует в allowlist`);
    }

    // Игнорируем пустые значения, чтобы не генерировать "WHERE col = NULL"
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return this;
    }

    this.values.push(value);
    const paramIndex = this.values.length;
    const alias = this.config.mainAlias;

    // Формируем безопасный фрагмент условия
    let condition = `${alias}.${filter.column} ${filter.operator} $${paramIndex}`;

    // Для GIN-индексов и массивов явно указываем тип, чтобы планировщик выбрал Index Scan
    if (filter.cast) {
      condition = `${alias}.${filter.column} ${filter.operator} $${paramIndex}::${filter.cast}`;
    }

    // Для ILIKE оборачиваем параметр процентами на уровне драйвера, 
    // но для явности оставим это на уровне сервиса. Здесь просто ставим оператор.
    
    this.conditions.push(condition);
    return this;
  }

  /**
   * Добавляет LEFT JOIN к справочнику.
   * JOIN выполняется только если ключ передан и разрешён конфигурацией.
   */
  addJoin(joinKey: string): this {
    const join = this.config.allowedJoins[joinKey];
    if (!join) throw new Error(`JOIN "${joinKey}" не разрешён в allowlist`);
    
    if (!this.addedJoins.has(joinKey)) {
      this.joins.push(`LEFT JOIN ${join.table} AS ${join.alias} ON ${join.on}`);
      this.addedJoins.add(joinKey);
    }
    return this;
  }

  /**
   * Добавляет условие ORDER BY.
   * По умолчанию сортировка DESC (самые свежие первые).
   */
  addSort(field: string, direction: 'ASC' | 'DESC' = 'DESC'): this {
    const column = this.config.allowedSorts[field];
    if (!column) {
      throw new Error(`Сортировка по полю "${field}" не разрешена в allowlist`);
    }
    this.orderClauses.push(`${this.config.mainAlias}.${column} ${direction}`);
    return this;
  }

  /**
   * Интегрирует курсорную пагинацию.
   * Генерирует: (alias.updated_at, alias.id) < / > ($ts::timestamptz, $id::int)
   * Это гарантирует использование композитного индекса и отсутствие дубликатов.
   */
  applyCursor(
    cursor: { updated_at: string; id: number } | null,
    direction: 'ASC' | 'DESC'
  ): this {
    const { cursorColumn, primaryKey, mainAlias } = this.config;

    if (cursor) {
      this.values.push(cursor.updated_at, cursor.id);
      const pTs = this.values.length - 1;
      const pId = this.values.length;
      const op = direction === 'DESC' ? '<' : '>';

      this.conditions.push(
        `(${mainAlias}.${cursorColumn}, ${mainAlias}.${primaryKey}) ${op} ($${pTs}::timestamptz, $${pId}::int)`
      );
    }

    // Если курсора нет, но указана сортировка, добавляем PK как tie-breaker
    if (!cursor && this.orderClauses.length > 0) {
      this.orderClauses.push(`${mainAlias}.${primaryKey} ${direction}`);
    }

    return this;
  }

  /** Устанавливает лимит записей. Внутренне всегда добавляется +1 для флага has_more */
  setLimit(limit: number): this {
    this.limit = limit + 1;
    return this;
  }

  /**
   * Финальная сборка запроса.
   * Возвращает объект, совместимый с pg.Pool.query(result.text, result.values)
   */
  build(): QueryResult {
    // Если сортировка не задана явно, используем безопасный дефолт
    if (this.orderClauses.length === 0) {
      this.orderClauses.push(
        `${this.config.mainAlias}.${this.config.cursorColumn} DESC`,
        `${this.config.mainAlias}.${this.config.primaryKey} DESC`
      );
    }

    //ГЕНЕРАЦИЯ SELECT
    let selectParts: string[];
    if (!this.selectedFields || this.selectedFields.length === 0) {
      // Дефолт: все колонки основной таблицы
      selectParts = [`${this.config.mainAlias}.*`];
    } else {
      selectParts = this.selectedFields.map(field => {
        const cfg = this.config.allowedFields[field];
        if (!cfg) {
          throw new Error(`Поле "${field}" отсутствует в allowlist проекции`);
        }
        // Автоматически подключаем справочник, если поле его требует
        if (cfg.joinKey) this.addJoin(cfg.joinKey);
        return `${cfg.dbRef} AS ${field}`;
      });
    }

    const select = `SELECT ${selectParts.join(', ')}`;
    const from = `FROM ${this.config.mainTable} AS ${this.config.mainAlias}`;
    const joins = this.joins.length ? `\n  ${this.joins.join('\n  ')}` : '';
    const where = this.conditions.length ? `\nWHERE ${this.conditions.join('\n  AND ')}` : '';
    const order = `\nORDER BY ${this.orderClauses.join(', ')}`;
    const limitPlaceholder = `$${this.values.length + 1}`;
    const limitClause = `\nLIMIT ${limitPlaceholder}`;

    const text = `${select}\n${from}${joins}${where}${order}${limitClause}`;
    const values = [...this.values, this.limit];

    return { text, values };
  }

  /**
   * Устанавливает список полей для SELECT.
   * Если передано, генерирует SELECT col1 AS f1, dict.col2 AS f2 вместо SELECT main.*
   * Автоматически добавляет необходимые JOIN-ы на основе конфига allowedFields.
   */
  selectFields(fields: string[]): this {
    this.selectedFields = fields;
    return this;
  }
}

// ============================================================================
// ПРЕКОНФИГУРИРОВАННЫЕ БИЛДЕРЫ ДЛЯ МОДУЛЕЙ
// Вынесены сюда, чтобы сервисы не хардкодили allowlist, а использовали готовые экземпляры.
// ============================================================================

/** Конфигурация для `declarations_full` */
export const declarationsConfig: QueryBuilderConfig = {
  mainTable: 'declarations_full',
  mainAlias: 'd',
  cursorColumn: 'updated_at',
  primaryKey: 'id',
  allowedFilters: {
    status_id: { column: 'status_id', operator: '=' },
    applicant_inn: { column: 'applicant_inn', operator: '=' },
    manufacturer_inn: { column: 'manufacturer_inn', operator: '=' },
    decl_number: { column: 'decl_number', operator: 'ILIKE' },
    sync_status: { column: 'sync_status', operator: '=' },
    decl_reg_date_from: { column: 'decl_reg_date', operator: '>=' },
    decl_reg_date_to: { column: 'decl_reg_date', operator: '<=' },
    doc_type_id: { column: 'doc_type_id', operator: '=' },
    product_origin_id: { column: 'product_origin_id', operator: '=' },
    applicant_type_id: { column: 'applicant_type_id', operator: '=' },
    tnved_ids: { column: 'tnved_ids', operator: '&&', cast: 'int[]' },
    tech_reg_ids: { column: 'tech_reg_ids', operator: '&&', cast: 'int[]' },
    groups_id: { column: 'groups_id', operator: '&&', cast: 'int[]' },
    single_list_ids: { column: 'single_list_ids', operator: '&&', cast: 'int[]' },
  },
  allowedSorts: {
    updated_at: 'updated_at',
    decl_reg_date: 'decl_reg_date',
    decl_end_date: 'decl_end_date',
    decl_number: 'decl_number',
  },
  allowedJoins: {
    status: { table: 'dict_statuses', alias: 'ds', on: 'd.status_id = ds.id' },
    doc_type: { table: 'dict_doc_types', alias: 'ddt', on: 'd.doc_type_id = ddt.id' },
    origin: { table: 'dict_oksm', alias: 'dok', on: 'd.product_origin_id = dok.id' },
    applicant_type: { table: 'dict_applicant_type', alias: 'dat', on: 'd.applicant_type_id = dat.id' },
    doc_object_type: { table: 'dict_object_types', alias: 'dot', on: 'd.doc_object_types_id = dot.id' },
  },
  allowedFields: {
    id: { dbRef: 'd.id' },
    decl_number: { dbRef: 'd.decl_number' },
    decl_reg_date: { dbRef: 'd.decl_reg_date' },
    decl_end_date: { dbRef: 'd.decl_end_date' },
    applicant_inn: { dbRef: 'd.applicant_inn' },
    manufacturer_inn: { dbRef: 'd.manufacturer_inn' },
    status_id: { dbRef: 'd.status_id' },
    status_name: { dbRef: 'ds.name', joinKey: 'status' },
    status_display_name: { dbRef: 'ds.display_name', joinKey: 'status' },
    doc_type_name: { dbRef: 'ddt.name', joinKey: 'doc_type' },
    doc_type_label: { dbRef: 'ddt.label', joinKey: 'doc_type' },
    origin_name: { dbRef: 'dok.name', joinKey: 'origin' },
    origin_short_name: { dbRef: 'dok.short_name', joinKey: 'origin' },
    applicant_type_name: { dbRef: 'dat.name', joinKey: 'applicant_type' },
    updated_at: { dbRef: 'd.updated_at' },
  },
};

/** Конфигурация для `sertificats_full` (зеркальная структуре деклараций) */
export const certificatesConfig: QueryBuilderConfig = {
  mainTable: 'sertificats_full',
  mainAlias: 's',
  cursorColumn: 'updated_at',
  primaryKey: 'id',
  allowedFilters: {
    status_id: { column: 'status_id', operator: '=' },
    applicant_inn: { column: 'applicant_inn', operator: '=' },
    manufacturer_inn: { column: 'manufacturer_inn', operator: '=' },
    cert_number: { column: 'cert_number', operator: 'ILIKE' },
    sync_status: { column: 'sync_status', operator: '=' },
    cert_reg_date_from: { column: 'cert_reg_date', operator: '>=' },
    cert_reg_date_to: { column: 'cert_reg_date', operator: '<=' },
    doc_type_id: { column: 'doc_type_id', operator: '=' },
    product_origin_id: { column: 'product_origin_id', operator: '=' },
    applicant_type_id: { column: 'applicant_type_id', operator: '=' },
    tnved_ids: { column: 'tnved_ids', operator: '&&', cast: 'int[]' },
    tech_reg_ids: { column: 'tech_reg_ids', operator: '&&', cast: 'int[]' },
    groups_id: { column: 'groups_id', operator: '&&', cast: 'int[]' },
    single_list_ids: { column: 'single_list_ids', operator: '&&', cast: 'int[]' },
  },
  allowedSorts: {
    updated_at: 'updated_at',
    cert_reg_date: 'cert_reg_date',
    cert_end_date: 'cert_end_date',
    cert_number: 'cert_number',
  },
  allowedJoins: {
    status: { table: 'dict_statuses', alias: 'ds', on: 's.status_id = ds.id' },
    doc_type: { table: 'dict_doc_types', alias: 'ddt', on: 's.doc_type_id = ddt.id' },
    origin: { table: 'dict_oksm', alias: 'dok', on: 's.product_origin_id = dok.id' },
    applicant_type: { table: 'dict_applicant_type', alias: 'dat', on: 's.applicant_type_id = dat.id' },
    doc_object_type: { table: 'dict_object_types', alias: 'dot', on: 's.doc_object_types_id = dot.id' },
  },
  allowedFields: {
    id: { dbRef: 's.id' },
    cert_number: { dbRef: 's.cert_number' },
    cert_reg_date: { dbRef: 's.cert_reg_date' },
    cert_end_date: { dbRef: 's.cert_end_date' },
    applicant_inn: { dbRef: 's.applicant_inn' },
    manufacturer_inn: { dbRef: 's.manufacturer_inn' },
    status_id: { dbRef: 's.status_id' },
    status_name: { dbRef: 'ds.name', joinKey: 'status' },
    status_display_name: { dbRef: 'ds.display_name', joinKey: 'status' },
    doc_type_name: { dbRef: 'ddt.name', joinKey: 'doc_type' },
    doc_type_label: { dbRef: 'ddt.label', joinKey: 'doc_type' },
    origin_name: { dbRef: 'dok.name', joinKey: 'origin' },
    origin_short_name: { dbRef: 'dok.short_name', joinKey: 'origin' },
    applicant_type_name: { dbRef: 'dat.name', joinKey: 'applicant_type' },
    updated_at: { dbRef: 's.updated_at' },
  },
};

/** Фабрика билдера для деклараций */
export function createDeclarationsQueryBuilder() {
  return new SafeQueryBuilder(declarationsConfig);
}

/** Фабрика билдера для сертификатов */
export function createCertificatesQueryBuilder() {
  return new SafeQueryBuilder(certificatesConfig);
}

