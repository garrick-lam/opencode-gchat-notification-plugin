export interface ResolvedConfig {
  readonly webhookUrl?: string;
  readonly minDurationSec: number;
  readonly cooldownMs: number;
  readonly timeZone?: string;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidTimeZone(tz: string): boolean {
  try {
    // Callable without `new`; invalid timeZone names throw RangeError.
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveConfig(
  options: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedConfig {
  const opts = options ?? {};
  const rawTimeZone =
    readString(opts.timeZone) ?? readString(env.OPENCODE_GCHAT_TIMEZONE);
  let timeZone = rawTimeZone;
  if (rawTimeZone !== undefined && !isValidTimeZone(rawTimeZone)) {
    // eslint-disable-next-line no-console -- a plugin's only logging channel
    console.warn(
      `[gchat-notify] Invalid timeZone "${rawTimeZone}"; using host-local time`,
    );
    timeZone = undefined;
  }
  return {
    webhookUrl:
      readString(opts.webhookUrl) ?? readString(env.OPENCODE_GCHAT_WEBHOOK_URL),
    minDurationSec: readNumber(
      opts.minDurationSec,
      readNumber(env.OPENCODE_GCHAT_MIN_DURATION_SEC, 0),
    ),
    cooldownMs: readNumber(opts.cooldownMs, 3000),
    timeZone,
  };
}
