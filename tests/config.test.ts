import { resolveConfig } from '../src/config';

const ENV = {
  OPENCODE_GCHAT_WEBHOOK_URL: 'https://env.example/hook',
  OPENCODE_GCHAT_MIN_DURATION_SEC: '45',
};

it('prefers option webhookUrl over env', () => {
  expect(
    resolveConfig({ webhookUrl: 'https://opt.example/hook' }, ENV).webhookUrl,
  ).toBe('https://opt.example/hook');
});

it('falls back to env webhook and min duration', () => {
  const c = resolveConfig({}, ENV);
  expect(c.webhookUrl).toBe('https://env.example/hook');
  expect(c.minDurationSec).toBe(45);
});

it('defaults: no webhook, 0 sec, 3000 ms cooldown', () => {
  expect(resolveConfig(undefined, {})).toEqual({
    webhookUrl: undefined,
    minDurationSec: 0,
    cooldownMs: 3000,
  });
});

it('reads cooldownMs only from options and ignores junk', () => {
  expect(
    resolveConfig({ cooldownMs: 5000, minDurationSec: 'nope' }, {}).cooldownMs,
  ).toBe(5000);
  expect(resolveConfig({ minDurationSec: 'nope' }, {}).minDurationSec).toBe(0);
});

it('ignores empty-string webhook options', () => {
  expect(resolveConfig({ webhookUrl: '' }, ENV).webhookUrl).toBe(
    'https://env.example/hook',
  );
});

it('prefers option timeZone over env', () => {
  expect(
    resolveConfig(
      { timeZone: 'Asia/Hong_Kong' },
      { OPENCODE_GCHAT_TIMEZONE: 'UTC' },
    ).timeZone,
  ).toBe('Asia/Hong_Kong');
});

it('falls back to env timeZone', () => {
  expect(resolveConfig({}, { OPENCODE_GCHAT_TIMEZONE: 'UTC' }).timeZone).toBe(
    'UTC',
  );
});

it('drops invalid timeZone to undefined', () => {
  expect(resolveConfig({ timeZone: 'Mars/Olympus' }, {}).timeZone).toBe(
    undefined,
  );
});

it('passes through aliases Intl accepts, without normalizing case', () => {
  expect(resolveConfig({ timeZone: 'utc' }, {}).timeZone).toBe('utc');
});

it('ignores empty-string timeZone options and falls back to env', () => {
  expect(
    resolveConfig({ timeZone: '  ' }, { OPENCODE_GCHAT_TIMEZONE: 'UTC' })
      .timeZone,
  ).toBe('UTC');
});
