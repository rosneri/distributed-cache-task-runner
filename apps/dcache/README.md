# @neriros/dcache

A distributed task cache for shell commands and Nx tasks. Hashes your source files and the lockfile, then replays the cached stdout/stderr/exit code on a hit so the task never runs twice for the same inputs.

## Install

```bash
npm i -g @neriros/dcache
# or
bun add -g @neriros/dcache
```

Requires Node.js >= 18.

## Usage

### Glob mode — cache any shell command

Hash the files matched by `--glob` (plus the detected lockfile and the command itself). On a hit, the original stdout/stderr/exit code are replayed:

```bash
dcache run "tsc --noEmit" --glob "src/**/*.ts"
dcache run "eslint ." --glob "src/**/*.{ts,tsx}"
```

#### Excluding files with `--ignore`

Use `--ignore` (repeatable) to drop paths from the hash input. This is essential for shared caches: any file that exists on one machine but not another (build outputs, local artifacts, generated debug bundles) will produce different hashes and force misses. Exclude them so the hash only depends on tracked source.

```bash
dcache run "eslint ." \
  --glob "{apps,libs}/**/*.{ts,tsx,js,mjs}" \
  --ignore "**/dist/**" \
  --ignore "**/.vercel/**" \
  --ignore "**/coverage/**"
```

The ignore patterns are also part of the cache-key manifest, so changing them invalidates the cache rather than silently reusing a stale entry.

### Nx mode

```bash
dcache run build --project my-app
```

> Nx mode is wired into the CLI but the project-graph integration is still landing — prefer glob mode today.

### Clear the cache

```bash
dcache clear
```

### Help

```bash
dcache --help
```

## How it works

1. Resolve the input files (glob or Nx project graph).
2. Compute a content hash over: each file, the detected lockfile (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), and a manifest of the task itself (command + args).
3. Look the hash up in the cache.
   - **Hit:** replay the stored stdout/stderr and exit with the stored code.
   - **Miss:** run the task, stream output, and store the result.

Because the hash includes the lockfile, dependency upgrades automatically invalidate stale entries.

## Configuration

Configuration lives in `dcache.config.json` in the current working directory. If no file is present, the defaults below are used.

| Key | Type | Default |
|---|---|---|
| `cacheDir` | `string` | `node_modules/.cache/dcache` |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` |
| `envFile` | `string` (path) | — |
| `ignore` | `string[]` | `[]` |
| `respectGitignore` | `boolean` | `true` |
| `provider` | provider config (see below) | filesystem at `cacheDir` |

`ignore` patterns apply to every glob-mode `run` and are merged with any `--ignore` flags passed on the command line. Use this for paths that should always be excluded from the hash on this project (build outputs, local artifacts, etc.):

```json
{
  "ignore": ["**/dist/**", "**/.vercel/**", "**/coverage/**", "**/.nx/**"]
}
```

`respectGitignore` (default `true`) restricts glob matches to files that are tracked or untracked-but-not-ignored by git, using `git ls-files --cached --others --exclude-standard`. This is the most reliable way to keep developer-machine artifacts (build outputs, local logs, scratch files) out of the cache hash so it matches a fresh CI checkout. Falls back to keeping all matched files (with a warning) when not in a git repo. Set to `false` to disable.

The `DCACHE_LOG_LEVEL` environment variable overrides `logLevel`.

String values support `${ENV_VAR}` interpolation. Use `envFile` to load a `.env` before interpolation runs — keeps secrets out of the config file.

### Filesystem provider (default)

```json
{
  "cacheDir": ".dcache",
  "logLevel": "debug",
  "provider": { "type": "filesystem" }
}
```

### PostgreSQL provider

Shared/distributed backend across machines and CI runners. Requires `pg` in the host project (`bun add pg` or `npm i pg`).

```json
{
  "envFile": ".env",
  "provider": {
    "type": "postgresql",
    "connectionString": "${DATABASE_URL}",
    "table": "dcache_entries"
  }
}
```

`table` is optional and defaults to `dcache_entries`.

## License

MIT
