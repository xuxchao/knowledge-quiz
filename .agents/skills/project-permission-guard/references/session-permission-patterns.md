# Session Permission Patterns

This reference summarizes Codex session history for `D:\work\personal-projects\knowledge-quiz2` inspected on 2026-07-09.

## Scope

- Related session files: 18
- Shell calls parsed: 303
- Calls that failed, timed out, or required escalation: 105

## Recurring Categories

| Category | Count | Notes |
| --- | ---: | --- |
| Node package tools | 47 | `pnpm`, `npm`, `npx`, `jest`, `eslint`, `tsc`, direct `node_modules` binaries. Common symptoms: exit `124`, binary resolution differences, `.pnpm-store` or PATH issues, lint/test failures that needed Volta or escalation. |
| Docker | 15 | `docker compose ps`, `docker exec ... postgres`, `docker exec ... langfuse`, and scripts that call Docker needed escalation. |
| Codex home scans | 8 | Recursive scans under `C:\Users\64535\.codex` can hit `.sandbox-secrets` access denied. |
| Ripgrep search | 4 | Windows glob and quoting issues, especially `**/*.spec.ts` passed directly as a positional path. |
| Direct Node runtime | 2 | Bundled runtime invocations may still need escalation when scripts inspect Docker or filesystem state. |
| Git global ignore warnings | observed | `git status` may print `unable to access 'C:\Users\64535/.config/git/ignore': Permission denied`; treat as an environment warning unless the actual status output changes. |

## Frequent Escalated Prefixes

| Prefix | Count |
| --- | ---: |
| `docker exec` | 11 |
| `npm test` | 11 |
| `npm run build` | 4 |
| `pnpm install` | 3 |
| `pnpm lint` | 1 |
| `pnpm db:reset:check` | 1 |
| `pnpm --filter backend test` | 1 |
| `npx tsc` | 1 |
| `node scripts/reset-databases.js --check` | 1 |
| `C:\Program Files\Volta\volta.exe run pnpm lint` | 1 |

## Command-Specific Guidance

- `pnpm lint`: if plain `pnpm lint` fails or behaves inconsistently, use `& 'C:\Program Files\Volta\volta.exe' run pnpm lint` with escalation.
- `pnpm install`: use `--prefer-offline` first when appropriate; request escalation for installs because dependency store, scripts, and network restrictions are common failure points.
- `npm test` / `pnpm --filter backend test`: rerun escalated after sandbox timeouts or binary resolution errors; use focused test files to reduce timeout risk.
- `docker compose ps` and `docker exec`: request escalation before running.
- `scripts/reset-databases.js --check` or `pnpm db:reset:check`: inspect script first, then escalate because it shells out to Docker and validates environment state.
- Recursive cleanup such as removing `.pnpm-store`: resolve workspace and target paths first; only remove if the target starts with the workspace path; request escalation and avoid reusable prefix rules.
- Session analysis: search `C:\Users\64535\.codex\sessions`, not the entire `.codex` tree.

