import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { setLogLevel, type LogLevel } from './logger.js';

const FilesystemProviderSchema = z.object({
  type: z.literal('filesystem'),
  cacheDir: z.string().optional(),
  ttlSeconds: z.number().int().positive().optional(),
});

const PostgresqlProviderSchema = z.object({
  type: z.literal('postgresql'),
  connectionString: z.string(),
  table: z.string().optional(),
  ttlSeconds: z.number().int().positive().optional(),
  statementTimeoutMs: z.number().int().nonnegative().optional(),
});

const ProviderSchema = z.discriminatedUnion('type', [
  FilesystemProviderSchema,
  PostgresqlProviderSchema,
]);

const ConfigFileSchema = z.object({
  cacheDir: z.string().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  envFile: z.string().optional(),
  provider: ProviderSchema.optional(),
  benchmarkInterval: z.number().int().nonnegative().optional(),
  ignore: z.array(z.string()).optional(),
  respectGitignore: z.boolean().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type FilesystemProviderConfig = z.infer<typeof FilesystemProviderSchema>;
export type PostgresqlProviderConfig = z.infer<typeof PostgresqlProviderSchema>;

export interface DcacheConfig {
  cacheDir: string;
  logLevel: LogLevel;
  provider: ProviderConfig;
  benchmarkInterval: number;
  ignore: string[];
  respectGitignore: boolean;
}

const INTERPOLATE_RE = /\$\{([A-Z0-9_]+)\}/gi;

function interpolate(value: string): string {
  return value.replace(INTERPOLATE_RE, (_, name: string) => {
    const v = process.env[name];
    if (v === undefined) {
      throw new Error(`Config references undefined env var: \${${name}}`);
    }
    return v;
  });
}

function interpolateDeep<T>(value: T): T {
  if (typeof value === 'string') return interpolate(value) as unknown as T;
  if (Array.isArray(value)) return value.map(interpolateDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v);
    }
    return out as T;
  }
  return value;
}

function readConfigFile(cwd: string): unknown {
  const configPath = join(cwd, 'dcache.config.json');
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function loadEnvFile(cwd: string, envFile: string): void {
  const path = isAbsolute(envFile) ? envFile : join(cwd, envFile);
  if (!existsSync(path)) {
    throw new Error(`envFile not found: ${path}`);
  }
  loadDotenv({ path, override: false, quiet: true });
}

export function loadConfig(cwd?: string): DcacheConfig {
  const resolvedCwd = resolve(cwd ?? process.cwd());
  const raw = readConfigFile(resolvedCwd);

  // Parse the envFile field first (no interpolation needed) so its vars
  // are available when interpolating the rest of the config.
  const preParsed = ConfigFileSchema.parse(raw);
  if (preParsed.envFile) {
    loadEnvFile(resolvedCwd, preParsed.envFile);
  }

  const interpolated = interpolateDeep(raw);
  const parsed = ConfigFileSchema.parse(interpolated);

  const defaultCacheDir = join(resolvedCwd, 'node_modules', '.cache', 'dcache');
  const cacheDir = parsed.cacheDir ?? defaultCacheDir;
  const logLevel: LogLevel = parsed.logLevel ?? 'info';
  setLogLevel(logLevel);

  const provider: ProviderConfig = parsed.provider ?? {
    type: 'filesystem',
    cacheDir,
  };

  const benchmarkInterval = parsed.benchmarkInterval ?? 100;
  const ignore = parsed.ignore ?? [];
  const respectGitignore = parsed.respectGitignore ?? true;

  return { cacheDir, logLevel, provider, benchmarkInterval, ignore, respectGitignore };
}
