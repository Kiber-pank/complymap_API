import { z } from 'zod';

/**
 * Схема валидации переменных окружения.
 * Гарантирует, что приложение либо запустится с полностью валидной конфигурацией,
 * либо аварийно завершится ДО начала обработки HTTP-трафика (принцип Fail-Fast).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(5432),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Раздельные параметры PostgreSQL (рекомендуется для production-оркестрации)
  DB_HOST: z.string().min(1,'Переменная DB_HOST обязательна'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_USER: z.string().min(1, 'Переменная DB_USER обязательна'),
  DB_PASSWORD: z.string().min(1, 'Переменная DB_PASSWORD обязательна'),
  DB_NAME: z.string().min(1, 'Переменная DB_NAME обязательна'),

  // Параметры пула соединений
  DB_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(20),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10000),

  // ✅ КОНФИГУРАЦИЯ SWAGGER (добавлено)
  SWAGGER_ENABLED: z.coerce.boolean().default(false),
  SWAGGER_ROUTE_PREFIX: z.string().default('/documentation'),
  SWAGGER_PROTECT: z.coerce.boolean().default(true),
  SWAGGER_USERNAME: z.string().optional(),
  SWAGGER_PASSWORD: z.string().optional(),
});

/** Типизированный интерфейс конфигурации, автоматически выведенный из Zod */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Загружает и валидирует process.env при импорте модуля.
 * Если валидация падает, процесс завершается с кодом 1.
 */
function loadConfig(): EnvConfig{
  const result = envSchema.safeParse(process.env);

  if(!result.success){
    const errors = result.error.issues.map(e=>`  • ${e.path.join('.')}: ${e.message}`).join('\n');
    console.error('Критическая ошибка конфигурации: \n', errors);
    process.exit(1);
  }

  return result.data;
}

// Экспортируем готовый объект. Дальше по коду process.env НЕ используется.
export const config = loadConfig();