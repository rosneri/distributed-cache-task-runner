<div align="center">

# dcache

**Never run the same task twice.**

A content-addressed, shareable cache for any shell command or Nx target.<br/>
Hash the inputs → replay the output. Locally, or across every machine and CI runner on your team.

[![npm version](https://img.shields.io/npm/v/@neriros/dcache?color=cb3837&logo=npm)](https://www.npmjs.com/package/@neriros/dcache)
[![npm downloads](https://img.shields.io/npm/dm/@neriros/dcache?logo=npm)](https://www.npmjs.com/package/@neriros/dcache)
[![Release](https://github.com/rosneri/distributed-cache-task-runner/actions/workflows/release.yml/badge.svg)](https://github.com/rosneri/distributed-cache-task-runner/actions/workflows/release.yml)
[![Node](https://img.shields.io/node/v/@neriros/dcache?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

[Quick start](#quick-start) · [Usage](#usage) · [How it works](#how-it-works) · [Configuration](#configuration) · [Contributing](#contributing)

</div>

---

```console
$ dcache run "tsc --noEmit" --glob "src/**/*.ts"
[dcache:info] Cache miss — running task

$ dcache run "tsc --noEmit" --glob "src/**/*.ts"
[dcache:info] Cache hit — skipping task execution   # instant: output replayed from cache
```

## Why dcache?

Your linter, type-checker, and build already ran on this exact code — on your laptop, on a teammate's, in CI. **dcache** remembers the result and hands it back instantly.

- ⚡ **Any command** — wrap `tsc`, `eslint`, `vitest`, `cargo`, a shell script… no plugin or framework required.
- 🌍 **Distributed** — point every developer and CI runner at one PostgreSQL backend and share hits across the team.
- 📦 **Restores outputs** — caches `dist/` and other artifacts, not just stdout/stderr and the exit code.
- 🔒 **Correct by default** — hashes file contents, the lockfile, and the command itself; respects `.gitignore` so local junk can't poison the key.
- 🧩 **Nx-aware** — resolves project files and `outputs` straight from the Nx project graph.
- 📉 **Self-benchmarking** — periodically re-runs cached tasks and warns when the cache is slower than just running the command.
- ⏳ **TTL & pruning** — expire stale entries per provider with `dcache prune`.

## Quick start

```bash
npm i -g @neriros/dcache        # or: bun add -g @neriros/dcache
```

```bash
dcache run "eslint ." --glob "src/**/*.{ts,tsx}"
```

That's it. Run it again — it's a cache hit. Change a file — it's a miss.

> Requires Node.js ≥ 18.

## Usage

```text
dcache <command> [options]

Commands:
  run <command> --glob <pattern>    Cache a shell command keyed on matched files
  run <task> --project <name>       Cache an Nx target keyed on the project graph
  clear                             Clear the cache
  prune                             Remove expired entries (requires provider.ttlSeconds)

Options:
  --glob <pattern>      Glob pattern for source files
  --ignore <pattern>    Exclude files from the hash (glob mode, repeatable)
  --project <name>      Nx project name
  --output <pattern>    Capture this path/glob as a cached output (repeatable)
  --help, -h            Show help
```

### Glob mode — cache any command

```bash
dcache run "tsc --noEmit" --glob "src/**/*.ts"
```

Arguments after the glob are passed through to the command:

```bash
dcache run vitest --glob "src/**/*.ts" run --reporter=dot
```

### Cache build outputs

Use `--output` (repeatable) to store artifacts. On a hit they're restored before the logs replay:

```bash
dcache run "vite build" --glob "src/**/*" --output dist
```

Only successful runs (exit code `0`) store artifacts.

### Exclude files from the hash

Anything that exists on one machine but not another forces misses on a shared cache. Drop it with `--ignore`:

```bash
dcache run "eslint ." \
  --glob "{apps,libs}/**/*.{ts,tsx}" \
  --ignore "**/dist/**" \
  --ignore "**/coverage/**"
```

Ignore patterns are part of the cache key, so changing them invalidates rather than reuses stale entries.

### Nx mode

```bash
dcache run build --project my-app
```

Input files come from the Nx project file map; outputs default to the target's `outputs` (override with `--output`).

### Housekeeping

```bash
dcache clear    # wipe the cache
dcache prune    # evict entries older than provider.ttlSeconds
```

## How it works

```text
          ┌──────────────┐   ┌────────────┐   ┌────────────────────┐
 inputs → │ source files │ + │  lockfile  │ + │ command + args +   │ ──► sha256 ──► cache key
          │ (glob / Nx)  │   │            │   │ glob + ignore list │
          └──────────────┘   └────────────┘   └────────────────────┘

                               ┌─ hit  ─► restore outputs · replay stdout/stderr · exit with stored code
 cache key ──► provider.get ───┤
                               └─ miss ─► run task · store result (+ outputs on success)
```

1. **Resolve inputs** — glob matches (filtered through `git ls-files` when `respectGitignore` is on) or the Nx project's files.
2. **Hash** — every file's content, the detected lockfile (`bun.lock`, `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), and a sorted task manifest.
3. **Look up** in the configured provider and either replay or execute.

Because the lockfile is in the key, dependency upgrades invalidate automatically.

## Configuration

Put a `dcache.config.json` in the directory you run from. Everything is optional.

```json
{
  "ignore": ["**/dist/**", "**/.nx/**"],
  "provider": { "type": "filesystem", "ttlSeconds": 604800 }
}
```

| Key                 | Type                                      | Default                         | Description                                                                 |
| ------------------- | ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `cacheDir`          | `string`                                  | `node_modules/.cache/dcache`    | Filesystem cache location.                                                  |
| `logLevel`          | `"debug" \| "info" \| "warn" \| "error"`  | `"info"`                        | Log verbosity; `debug` prints the hash and benchmark timings.               |
| `envFile`           | `string`                                  | —                               | `.env` file loaded before `${VAR}` interpolation.                           |
| `ignore`            | `string[]`                                | `[]`                            | Always-excluded globs, merged with `--ignore`.                              |
| `respectGitignore`  | `boolean`                                 | `true`                          | Only hash files git tracks (or untracked-but-not-ignored).                  |
| `benchmarkInterval` | `number`                                  | `100`                           | Re-run a cached task on the 1st and every Nth hit to measure cache benefit. `0` disables. |
| `provider`          | `object`                                  | filesystem at `cacheDir`        | Storage backend — see below.                                                |

All string values support `${ENV_VAR}` interpolation, so secrets stay out of the file.

The `DCACHE_LOG_LEVEL` environment variable overrides `logLevel`, e.g. `DCACHE_LOG_LEVEL=debug dcache run …`.

### Providers

<details open>
<summary><b>Filesystem</b> (default) — local, zero setup</summary>

```json
{
  "provider": { "type": "filesystem", "cacheDir": ".dcache", "ttlSeconds": 86400 }
}
```

</details>

<details>
<summary><b>PostgreSQL</b> — share the cache across machines and CI</summary>

Install the optional peer dependency in your project:

```bash
npm i pg        # or: bun add pg
```

```json
{
  "envFile": ".env",
  "provider": {
    "type": "postgresql",
    "connectionString": "${DATABASE_URL}",
    "table": "dcache_entries",
    "ttlSeconds": 604800,
    "statementTimeoutMs": 300000
  }
}
```

| Key                  | Default          |
| -------------------- | ---------------- |
| `table`              | `dcache_entries` |
| `ttlSeconds`         | no expiry        |
| `statementTimeoutMs` | `300000` (5 min) |

The table is created automatically on first use.

</details>

## Contributing

dcache is an [Nx](https://nx.dev) monorepo using [bun](https://bun.sh) workspaces, strict TypeScript, and [Vitest](https://vitest.dev).

```bash
git clone https://github.com/rosneri/distributed-cache-task-runner.git
cd distributed-cache-task-runner
bun install

nx affected -t test,lint,typecheck   # all checks
nx run dcache:bundle                 # build the CLI
```

```text
apps/dcache/          CLI entry point
libs/cli/             Commands + argument parsing
libs/config/          Config loading, logger, lockfile detection
libs/hasher/          Content hashing
libs/cache/           Cache providers (filesystem, PostgreSQL) + artifacts
libs/runner/          Task execution
libs/nx-integration/  Nx project graph integration
examples/basic/       Manual testing playground
```

See [`CLAUDE.md`](./CLAUDE.md) for conventions and module-boundary rules. Releases are published to npm automatically on `v*` tags.

## License

[MIT](https://opensource.org/licenses/MIT)
