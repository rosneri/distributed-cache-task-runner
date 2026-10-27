import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';

describe('loadConfig', () => {
  let tempDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const TRACKED = ['MY_DB_URL', 'MISSING_VAR', 'FROM_ENVFILE', 'DCACHE_LOG_LEVEL'];

  function makeTempDir(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'dcache-config-test-'));
    return tempDir;
  }

  beforeEach(() => {
    for (const k of TRACKED) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    setLogLevel('info');
  });

  it('returns default config when no config file', () => {
    const dir = makeTempDir();
    const config = loadConfig(dir);
    expect(config.cacheDir).toBe(join(dir, 'node_modules', '.cache', 'dcache'));
    expect(config.logLevel).toBe('info');
    expect(config.provider).toEqual({
      type: 'filesystem',
      cacheDir: join(dir, 'node_modules', '.cache', 'dcache'),
    });
  });

  it('reads cacheDir and logLevel from config file', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({ cacheDir: '/custom/cache', logLevel: 'debug' }),
    );
    const config = loadConfig(dir);
    expect(config.cacheDir).toBe('/custom/cache');
    expect(config.logLevel).toBe('debug');
  });

  it('applies logLevel to the logger', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'dcache.config.json'), JSON.stringify({ logLevel: 'error' }));
    loadConfig(dir);
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    logger.info('hidden');
    logger.error('visible');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('reads explicit filesystem provider', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({ provider: { type: 'filesystem', cacheDir: '/fs/cache' } }),
    );
    const config = loadConfig(dir);
    expect(config.provider).toEqual({ type: 'filesystem', cacheDir: '/fs/cache' });
  });

  it('reads postgresql provider with env interpolation', () => {
    const dir = makeTempDir();
    process.env['MY_DB_URL'] = 'postgres://u:p@host/db';
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({
        provider: {
          type: 'postgresql',
          connectionString: '${MY_DB_URL}',
          table: 'cache',
        },
      }),
    );
    const config = loadConfig(dir);
    expect(config.provider).toEqual({
      type: 'postgresql',
      connectionString: 'postgres://u:p@host/db',
      table: 'cache',
    });
  });

  it('throws on undefined interpolated env var', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({
        provider: { type: 'postgresql', connectionString: '${MISSING_VAR}' },
      }),
    );
    expect(() => loadConfig(dir)).toThrow(/MISSING_VAR/);
  });

  it('loads vars from envFile before interpolating', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'FROM_ENVFILE=postgres://from-envfile\n');
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({
        envFile: '.env',
        provider: { type: 'postgresql', connectionString: '${FROM_ENVFILE}' },
      }),
    );
    const config = loadConfig(dir);
    expect(config.provider).toEqual({
      type: 'postgresql',
      connectionString: 'postgres://from-envfile',
    });
  });

  it('throws when envFile does not exist', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({ envFile: '.env.missing' }),
    );
    expect(() => loadConfig(dir)).toThrow(/envFile not found/);
  });

  it('rejects invalid logLevel', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'dcache.config.json'),
      JSON.stringify({ logLevel: 'verbose' }),
    );
    expect(() => loadConfig(dir)).toThrow();
  });
});
