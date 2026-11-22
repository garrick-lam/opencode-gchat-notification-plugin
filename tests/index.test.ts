import pluginDefault from '../src/index';

jest.mock(
  '@opencode/plugin',
  () => ({ Plugin: { define: (p: unknown) => p } }),
  { virtual: true },
);

interface FakeEvent {
  type: string;
  data: Record<string, unknown>;
}

interface FakeCtx {
  options: Record<string, unknown>;
  location: { directory: string };
  event: {
    subscribe: (options?: { signal?: AbortSignal }) => AsyncIterable<FakeEvent>;
  };
  session: {
    get: (input: { sessionID: string }) => Promise<{
      parentID?: string;
      title?: string;
      location?: { directory: string };
    }>;
  };
  tool: {
    hook: (
      name: string,
      callback: (event: Record<string, unknown>) => void,
    ) => Promise<{ dispose: jest.Mock }>;
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function makeCtx(options: Record<string, unknown>, events: FakeEvent[]) {
  let capturedSignal: AbortSignal | undefined;
  let toolCallback: ((event: Record<string, unknown>) => void) | undefined;
  const disposeMock = jest.fn().mockResolvedValue(undefined);
  const ctx: FakeCtx = {
    options,
    location: { directory: '/work/proj' },
    event: {
      async *subscribe(opts?: { signal?: AbortSignal }) {
        capturedSignal = opts?.signal;
        for (const event of events) yield event;
      },
    },
    session: {
      get: async () => ({
        title: 'Fix login',
        location: { directory: '/work/proj' },
      }),
    },
    tool: {
      hook: async (_name, callback) => {
        toolCallback = callback;
        return { dispose: disposeMock };
      },
    },
  };
  return {
    ctx,
    getSignal: () => capturedSignal,
    getDisposeMock: () => disposeMock,
    getToolCallback: () => toolCallback,
  };
}

function sentBody(call: number): {
  text: string;
  cardsV2: Array<{
    card: {
      sections: Array<{
        widgets: Array<
          | { decoratedText: { topLabel: string; text: string } }
          | { textParagraph: { text: string; textSyntax: string } }
        >;
      }>;
    };
  }>;
} {
  const fetchMock = global.fetch as unknown as jest.Mock;
  const init = fetchMock.mock.calls[call][1] as { body: string };
  return JSON.parse(init.body);
}

const plugin = pluginDefault as unknown as {
  id: string;
  setup: (ctx: FakeCtx) => Promise<(() => void) | undefined>;
};

describe('with no webhook configured', () => {
  const savedUrl = process.env.OPENCODE_GCHAT_WEBHOOK_URL;
  beforeAll(() => {
    delete process.env.OPENCODE_GCHAT_WEBHOOK_URL;
  });
  afterAll(() => {
    if (savedUrl !== undefined)
      process.env.OPENCODE_GCHAT_WEBHOOK_URL = savedUrl;
  });

  it('setup with no webhook URL', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    const { ctx } = makeCtx({}, []);
    const cleanup = await plugin.setup(ctx);
    await flush();
    expect(cleanup).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[gchat-notify] No webhook URL configured (options.webhookUrl or OPENCODE_GCHAT_WEBHOOK_URL); notifications disabled',
    );
    log.mockRestore();
  });
});

describe('with a webhook configured', () => {
  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  it('notifies google chat across the wired event stream', async () => {
    const events: FakeEvent[] = [
      { type: 'session.execution.started', data: { sessionID: 'ses_w1' } },
      { type: 'session.execution.succeeded', data: { sessionID: 'ses_w1' } },
    ];
    const { ctx, getSignal, getDisposeMock } = makeCtx(
      { webhookUrl: 'https://chat.example/hook' },
      events,
    );
    const cleanup = await plugin.setup(ctx);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody(0);
    expect(body.text).toContain('✅');
    expect(body.text).toContain('Task Completed');
    const session = body.cardsV2[0].card.sections[0].widgets[0] as {
      decoratedText: { topLabel: string; text: string };
    };
    expect(session.decoratedText).toEqual({
      topLabel: 'Session',
      text: 'Fix login',
    });
    const fetchMock = global.fetch as unknown as jest.Mock;
    expect(fetchMock.mock.calls[0][0]).toBe('https://chat.example/hook');
    cleanup?.();
    expect(getSignal()?.aborted).toBe(true);
    expect(getDisposeMock()).toHaveBeenCalled();
  });

  it('routes question tool calls to the notifier', async () => {
    const { ctx, getToolCallback } = makeCtx(
      { webhookUrl: 'https://chat.example/hook' },
      [],
    );
    await plugin.setup(ctx);
    await flush();
    const callback = getToolCallback();
    expect(callback).toBeDefined();
    callback?.({
      tool: 'question',
      sessionID: 'ses_q1',
      input: { questions: [{ question: 'Ship it?' }] },
    });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody(0);
    expect(body.text).toContain('User Input Needed');
    expect(body.text).not.toContain('OpenCode asked');
    const details = body.cardsV2[0].card.sections[0].widgets[1] as {
      decoratedText: { text: string };
    };
    expect(details.decoratedText?.text).toContain('OpenCode asked: "Ship it?"');
    callback?.({
      tool: 'read',
      sessionID: 'ses_q1',
      input: { path: '/tmp/x' },
    });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fences permission details end to end', async () => {
    const events: FakeEvent[] = [
      {
        type: 'permission.asked',
        data: { sessionID: 'ses_p1', action: 'bash', resources: ['rm -rf *'] },
      },
    ];
    const { ctx } = makeCtx(
      { webhookUrl: 'https://chat.example/hook' },
      events,
    );
    await plugin.setup(ctx);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody(0);
    expect(body.text).toContain('Approval Required');
    const details = body.cardsV2[0].card.sections[0].widgets[1] as {
      textParagraph: { text: string };
    };
    expect(details.textParagraph?.text).toBe(
      'Permission requested for bash:\n```\nrm -rf *\n```',
    );
  });
});
