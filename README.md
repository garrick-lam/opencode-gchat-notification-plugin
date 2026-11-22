# opencode-gchat-notification-plugin

An [OpenCode](https://opencode.ai) V2 server plugin that sends push notifications to
**Google Chat** when a session finishes its task, fails, or is blocked waiting for you —
so you can context-switch away during long agent runs.

## Notifications

| Event | Card |
| --- | --- |
| Task completed (`session.execution.succeeded`) | ✅ **Task Completed** — with elapsed time when known |
| Permission prompt (`permission.asked`) | ⚠️ **Approval Required** — action + resources |
| Clarification question (`question` tool) | 💬 **User Input Needed** — quotes the first question |
| Failure / interrupt (`session.execution.failed` / `.interrupted`) | 🛑 **Session Interrupted** — error message or reason |

Noise filters:

- Sub-agent sessions (child sessions with a `parentID`) are never notified.
- Sessions outside this project's directory tree are skipped, so per-project instances
  don't double-notify.
- Short runs below `minDurationSec` don't ping.
- Repeated events inside `cooldownMs` are deduplicated.
- Timestamps honor `timeZone` (defaults to the host machine's local timezone).
- User-initiated interrupts (`reason: "user"`) are silent — you're already at the keyboard.
- A failed run doesn't also send a follow-up ✅.

## Google Chat webhook

Create an incoming webhook for your space:
[Google Chat apps → Webhooks](https://developers.google.com/hangouts/chat/how-tos/webhooks).
Copy the resulting URL — it looks like
`https://chat.googleapis.com/v1/spaces/AAA…/messages?key=…&token=…`.

## Install

```shell
yarn add opencode-gchat-notification-plugin
```

## Configure

Add the plugin to `opencode.json(c)` (per project) or `~/.config/opencode/opencode.json(c)` (global):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-gchat-notification-plugin",
      "options": {
        "webhookUrl": "https://chat.googleapis.com/v1/spaces/…",
        "minDurationSec": 30,
        "cooldownMs": 3000,
        "timeZone": "Asia/Hong_Kong"
      }
    }
  ]
}
```

### Options

| Option | Env fallback | Default | Meaning |
| --- | --- | --- | --- |
| `webhookUrl` | `OPENCODE_GCHAT_WEBHOOK_URL` | — | Google Chat webhook URL. Options win over env. Without it the plugin stays inert (one log line). |
| `minDurationSec` | `OPENCODE_GCHAT_MIN_DURATION_SEC` | `0` | Skip the ✅ notification for runs shorter than this. |
| `cooldownMs` | — | `3000` | Dedupe window per session + event kind. |
| `timeZone` | `OPENCODE_GCHAT_TIMEZONE` | host-local | IANA timezone (e.g. `Asia/Hong_Kong`) for card timestamps. Invalid values warn once at startup and fall back to host-local. When set, the time shows a short zone name (`14:32 HKT`). |

The webhook URL is a secret: prefer the env var (or options in a config file you don't commit)
over committing it to a shared repository.

## Development

```shell
yarn build    # tsc --noEmit typecheck (OpenCode loads the TS source directly)
yarn test     # jest
yarn lint     # eslint
```

This repo dogfoods the plugin: `.opencode/plugins/gchat-notify/index.ts` re-exports the
package default, so the plugin auto-loads for OpenCode sessions started in this directory.
It has no `options`, so set the webhook via the environment:

```shell
export OPENCODE_GCHAT_WEBHOOK_URL="https://chat.googleapis.com/v1/spaces/…"
export OPENCODE_GCHAT_TIMEZONE="Asia/Hong_Kong"
```

Publishing is automated by semantic-release through GitHub Actions on the default branch.
