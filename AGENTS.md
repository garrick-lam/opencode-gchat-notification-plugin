# AGENTS.md

OpenCode V2 server plugin that pushes Google Chat notifications on session events
(`opencode-gchat-notification-plugin`). Yarn 1, Node 22.

Installs work against the public npm registry only.

## Commands

- `yarn build` — typecheck only (`tsc --noEmit`). There is no build output: `package.json`
  `exports` points at `src/index.ts` and OpenCode loads the TS source directly.
- `yarn test` — jest (ts-jest). Single file: `yarn test tests/notifier.test.ts`.
- `yarn lint` — oxlint, covers `src/` and `tests/` (`lint:fix` applies fixes).
- CI (GitHub Actions) runs: `yarn install` → `yarn build` → `yarn lint` → `LOG_LEVEL=OFF yarn test:coverage --silent`.

## Architecture

Deliberate split between plugin wiring and pure logic; tests never hit the network.

- `src/index.ts` — entry. `Plugin.define({ id: 'gchat-notify', setup })`: resolves config,
  subscribes to `session.execution.started/idle/failed/interrupted` + `permission.asked` via
  `ctx.event.subscribe`, hooks `execute.before` to catch `question` tool calls, returns a
  cleanup function.
- `src/notifier.ts` — all noise-filter/dedup logic, in a `Notifier` class with injected deps
  (`now`, `getSession`, `send`). Filters: child sessions (`parentID`) skipped, sessions outside
  the plugin's directory tree skipped, runs shorter than `minDurationSec` skipped,
  per-session+event-kind `cooldownMs` dedupe, user interrupts silent, no ✅ after a failure.
- `src/config.ts` — plugin options override env: `webhookUrl` (`OPENCODE_GCHAT_WEBHOOK_URL`),
  `minDurationSec` (`OPENCODE_GCHAT_MIN_DURATION_SEC`), `timeZone` (`OPENCODE_GCHAT_TIMEZONE`,
  validated IANA name; invalid falls back to host-local with a startup warning), `cooldownMs` (no env fallback).
  Without a webhook URL the plugin is inert (one log line).
- `src/google-chat.ts` — card payload + HTTP POST.
- `tests/` mirrors `src/`; build fakes for `NotifierDeps` like the existing tests do.

Design rationale lives in `docs/superpowers/specs/`.

## Gotchas

- Importing `@opencode/plugin` only typechecks because `tsconfig.json` `paths` remaps it to
  `node_modules/@opencode/plugin/dist/promise/index.d.ts` (the package is exports-only, no
  `main`). Keep that mapping if you touch tsconfig.
- This repo dogfoods the plugin: `.opencode/plugins/gchat-notify/index.ts` re-exports
  `src/index.ts` and root `opencode.jsonc` loads it with a live webhook URL. Edits to `src/`
  change the plugin your own OpenCode sessions here actually run.
- Releases are automated by semantic-release on the default branch via GitHub Actions CI — use
  Conventional Commit messages (`feat:`, `fix:`, …); they determine the published version.
