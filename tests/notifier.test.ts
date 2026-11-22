import {
  Notifier,
  NotifierDeps,
  NotificationRequest,
  SessionSummary,
} from '../src/notifier';

function makeDeps(overrides: Partial<NotifierDeps> = {}) {
  let clock = 1_000_000;
  const sent: NotificationRequest[] = [];
  let session: SessionSummary | undefined = {
    title: 'Fix login',
    location: { directory: '/work/proj' },
  };
  const deps: NotifierDeps = {
    config: {
      webhookUrl: 'https://x/hook',
      minDurationSec: 0,
      cooldownMs: 3000,
    },
    projectName: 'proj',
    locationDirectory: '/work/proj',
    now: () => clock,
    getSession: async () => session,
    send: async (r) => {
      sent.push(r);
    },
    ...overrides,
  };
  return {
    deps,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
    setSession: (s: SessionSummary | undefined) => {
      session = s;
    },
  };
}

function requestFields(r: NotificationRequest) {
  return {
    badge: r.badge,
    title: r.title,
    sessionTitle: r.sessionTitle,
    details: r.details,
  };
}

it('sends ✅ with elapsed seconds on idle after started', async () => {
  const { deps, sent, advance } = makeDeps();
  const n = new Notifier(deps);
  n.onExecutionStarted('ses_1');
  advance(12_500);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toEqual({
    badge: '✅',
    title: 'Task Completed',
    sessionTitle: 'Fix login',
    details:
      'Agent finished processing (13s) and is ready for your next prompt.',
  });
  expect(typeof sent[0].timestamp).toBe('string');
});

it('sends ✅ without duration when started event was missed', async () => {
  const { deps, sent } = makeDeps();
  const n = new Notifier(deps);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toEqual({
    badge: '✅',
    title: 'Task Completed',
    sessionTitle: 'Fix login',
    details: 'Agent finished processing and is ready for your next prompt.',
  });
});

it('suppresses short runs below minDurationSec', async () => {
  const { deps, sent, advance } = makeDeps({
    config: {
      webhookUrl: 'https://x/hook',
      minDurationSec: 30,
      cooldownMs: 3000,
    },
  });
  const n = new Notifier(deps);
  n.onExecutionStarted('ses_1');
  advance(5_000);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(0);
});

it('sends 🛑 with error message and suppresses the following ✅', async () => {
  const { deps, sent } = makeDeps();
  const n = new Notifier(deps);
  await n.onFailed('ses_1', { message: 'provider 500' });
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toMatchObject({
    badge: '🛑',
    details: 'provider 500',
  });
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(1);
});

it('skips user-initiated interrupts but warns on shutdown', async () => {
  const { deps, sent } = makeDeps();
  const n = new Notifier(deps);
  await n.onInterrupted('ses_1', 'user');
  expect(sent).toHaveLength(0);
  await n.onInterrupted('ses_1', 'shutdown');
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toEqual({
    badge: '🛑',
    title: 'Session Interrupted',
    sessionTitle: 'Fix login',
    details: 'Session was interrupted: shutdown.',
  });
});

it('skips sub-agent sessions', async () => {
  const { deps, sent, setSession } = makeDeps();
  setSession({ parentID: 'ses_parent' });
  const n = new Notifier(deps);
  n.onExecutionStarted('ses_1');
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(0);
});

it('skips sessions outside the location tree', async () => {
  const { deps, sent, setSession } = makeDeps();
  setSession({ location: { directory: '/elsewhere/other' } });
  const n = new Notifier(deps);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(0);
});

it('allows nested sessions inside the location tree', async () => {
  const { deps, sent, setSession } = makeDeps();
  setSession({
    title: 'wt',
    location: { directory: '/work/proj/worktrees/x' },
  });
  const n = new Notifier(deps);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(1);
  expect(sent[0].sessionTitle).toBe('wt');
});

it('notifies with fallback title when getSession throws', async () => {
  const { deps, sent } = makeDeps({
    getSession: async () => {
      throw new Error('boom');
    },
  });
  const n = new Notifier(deps);
  await n.onIdle('ses_abcdefghijklmn');
  expect(sent).toHaveLength(1);
  expect(sent[0].sessionTitle).toBe('ses_abcdefgh');
});

it('dedupes repeated idle events within cooldown', async () => {
  const { deps, sent, advance } = makeDeps();
  const n = new Notifier(deps);
  n.onExecutionStarted('ses_1');
  advance(200);
  await n.onIdle('ses_1');
  advance(100);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(1);
  advance(3_000);
  n.onExecutionStarted('ses_1');
  advance(200);
  await n.onIdle('ses_1');
  expect(sent).toHaveLength(2);
});

it('maps permission.asked to ⚠️ with action and per-line resources', async () => {
  const { deps, sent } = makeDeps();
  const n = new Notifier(deps);
  await n.onPermissionAsked('ses_1', 'bash', ['rm -rf *', 'git push']);
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toEqual({
    badge: '⚠️',
    title: 'Approval Required',
    sessionTitle: 'Fix login',
    details: 'Permission requested for bash:',
  });
  expect(sent[0].codeBlock).toBe(true);
  expect(sent[0].codeDetails).toBe('rm -rf *\ngit push');
});

it('maps permission.asked without resources to plain prose', async () => {
  const { deps, sent } = makeDeps();
  const n = new Notifier(deps);
  await n.onPermissionAsked('ses_1', 'webfetch', []);
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toEqual({
    badge: '⚠️',
    title: 'Approval Required',
    sessionTitle: 'Fix login',
    details: 'Permission requested for webfetch.',
  });
  expect(sent[0].codeBlock).toBe(true);
  expect(sent[0].codeDetails).toBeUndefined();
});

it('maps question tool to 💬 quoting the first question', async () => {
  const { deps, sent } = makeDeps();
  const n = new Notifier(deps);
  await n.onQuestion('ses_1', [
    { question: 'Tabs or spaces?' },
    { question: 'Why?' },
  ]);
  expect(sent).toHaveLength(1);
  expect(requestFields(sent[0])).toEqual({
    badge: '💬',
    title: 'User Input Needed',
    sessionTitle: 'Fix login',
    details: 'OpenCode asked: "Tabs or spaces?"',
  });
  expect(sent[0].codeBlock).toBeUndefined();
});

it('never rejects: send errors are logged, not thrown', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation();
  const { deps } = makeDeps({
    send: async () => {
      throw new Error('webhook down');
    },
  });
  const n = new Notifier(deps);
  await expect(n.onIdle('ses_1')).resolves.toBeUndefined();
  expect(err).toHaveBeenCalledWith('[gchat-notify]', expect.any(Error));
  err.mockRestore();
});

it('renders the timestamp in the configured timeZone', async () => {
  const fixed = Date.UTC(2026, 10, 13, 6, 32); // 2026-11-13 06:32 UTC = 14:32 HKT
  const { deps, sent } = makeDeps({
    config: {
      webhookUrl: 'https://x/hook',
      minDurationSec: 0,
      cooldownMs: 3000,
      timeZone: 'Asia/Hong_Kong',
    },
    now: () => fixed,
  });
  const n = new Notifier(deps);
  await n.onIdle('ses_1');
  expect(sent[0].timestamp).toBe(
    new Date(fixed).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Hong_Kong',
      timeZoneName: 'short',
    }),
  );
});

it('renders a bare host-local timestamp when no timeZone is configured', async () => {
  const fixed = Date.UTC(2026, 10, 13, 6, 32);
  const { deps, sent } = makeDeps({ now: () => fixed });
  const n = new Notifier(deps);
  await n.onIdle('ses_1');
  expect(sent[0].timestamp).toBe(
    new Date(fixed).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
  );
});
