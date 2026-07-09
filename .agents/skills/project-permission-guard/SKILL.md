---
name: project-permission-guard
description: Project-specific guardrails for avoiding recurring Codex sandbox, approval, Windows PowerShell, package-manager, Docker, Volta, and Codex-session scanning permission failures in D:\work\personal-projects\knowledge-quiz2. Use before running pnpm/npm/npx/jest/eslint/tsc/build/lint/test commands, Docker or docker compose commands, Start-Process/background server commands, destructive cleanup, scans under C:\Users\64535\.codex, or any command likely to need sandbox_permissions=require_escalated.
---

# Project Permission Guard

## Quick Rule

Classify the command before running it:

- Pure reads inside the workspace: run normally.
- Package-manager validation (`pnpm`, `npm`, `npx`, `jest`, `eslint`, `tsc`, `build`, `lint`, `test`): prefer the project/Volta path below; retry with escalation after sandbox-style failure or timeout.
- Docker access (`docker`, `docker compose`, `docker exec`): request escalation up front.
- Background servers or process inspection (`Start-Process`, visible GUI apps, `Get-Process` used to verify launched services): request escalation when launching; keep `-WindowStyle Hidden`.
- Deleting/moving recursively: verify resolved absolute paths are inside the intended workspace, then request escalation. Never provide a reusable `prefix_rule` for destructive commands.
- Codex home scans: avoid recursive scans of all `C:\Users\64535\.codex`; exclude `.sandbox-secrets` and prefer targeted `sessions` paths.

## Preferred Commands

Use the bundled/runtime tools when ordinary commands fail or when PATH is ambiguous:

```powershell
& 'C:\Program Files\Volta\volta.exe' run pnpm lint
```

```powershell
& 'C:\Users\64535\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' <script-or-bin>
```

For package-manager commands that modify dependencies or may touch the global/package store, request escalation:

```json
{
  "sandbox_permissions": "require_escalated",
  "prefix_rule": ["pnpm", "install"],
  "justification": "允许我安装或刷新项目依赖吗？沙箱下 pnpm install 经常因 store/网络/脚本权限失败。"
}
```

For lint/test/build commands, first try the normal project command. If it exits `124`, cannot resolve binaries, cannot access `.pnpm-store`, or behaves differently from the user's shell, rerun escalated with a narrow prefix such as:

- `["pnpm", "lint"]`
- `["pnpm", "test"]`
- `["npm", "test"]`
- `["npm", "run", "build"]`
- `["C:\Program Files\Volta\volta.exe", "run", "pnpm", "lint"]`

## Docker Commands

Request escalation before Docker commands. The session history repeatedly needed escalation for:

- `docker compose ps`
- `docker exec knowledge-doc-postgres ...`
- `docker exec knowledge-doc-langfuse ...`
- `pnpm db:reset:check` when it shells out to Docker

Use narrow `prefix_rule` values, for example `["docker", "exec"]`, `["docker", "compose"]`, or `["pnpm", "db:reset:check"]`.

## Codex Session Scans

Do not run broad recursive scans over `C:\Users\64535\.codex`; `.sandbox-secrets` returns access denied. Prefer:

```powershell
rg -l 'knowledge-quiz2' 'C:\Users\64535\.codex\sessions'
```

```powershell
Get-ChildItem -Recurse -File -LiteralPath 'C:\Users\64535\.codex\sessions' -Filter '*.jsonl'
```

If scanning `C:\Users\64535\.codex` is unavoidable, explicitly skip `.sandbox-secrets`, `.sandbox`, large sqlite files, and plugin caches.

## PowerShell Pitfalls

- Use `-LiteralPath` for Windows paths, generated filenames, and paths containing brackets or wildcards.
- Avoid chaining noisy commands with separators when parallel file reads are possible.
- In PowerShell, split commands with newlines only when the sandbox evaluator can still understand the intended command. If a command uses pipes, redirection, environment variables, or wildcards and then fails with sandbox/network symptoms, rerun with escalation rather than rewriting around approvals.
- `rg` globs like `backend/src/**/*.spec.ts` can fail on Windows depending on shell expansion. Prefer explicit directories plus `-g`, for example `rg -n 'pattern' backend/src -g '*.spec.ts'`.

## Reference

For the current conversation-derived statistics and representative failure patterns, read `references/session-permission-patterns.md`.

