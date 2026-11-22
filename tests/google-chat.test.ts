import { buildCardPayload, sendCard } from '../src/google-chat';

const PARAMS = {
  badge: '✅',
  title: 'Task Completed',
  sessionTitle: 'Fix login bug',
  details: 'Agent finished processing (12s) and is ready for your next prompt.',
  timestamp: '09:05',
  projectName: 'my-project',
};

it('builds the cardsV2 payload', () => {
  const p = buildCardPayload(PARAMS);
  expect(p.text).toBe('✅ [my-project] Task Completed');
  const { card } = p.cardsV2[0];
  expect(card.header).toEqual({
    title: 'Task Completed',
    subtitle: 'Project: my-project • 09:05',
  });
  expect(card.sections[0].widgets).toEqual([
    { decoratedText: { topLabel: 'Session', text: 'Fix login bug' } },
    {
      decoratedText: {
        topLabel: 'Details',
        text: PARAMS.details,
        wrapText: true,
      },
    },
  ]);
});

it('renders flagged details as markdown verbatim when codeBlock is set', () => {
  const p = buildCardPayload({ ...PARAMS, codeBlock: true });
  expect(p.cardsV2[0].card.sections[0].widgets[1]).toEqual({
    textParagraph: { text: PARAMS.details, textSyntax: 'MARKDOWN' },
  });
});

it('composes prose details with a fenced code block when codeDetails is set', () => {
  const p = buildCardPayload({
    ...PARAMS,
    codeBlock: true,
    codeDetails: 'rm -rf *\ngit push',
  });
  expect(p.cardsV2[0].card.sections[0].widgets[1]).toEqual({
    textParagraph: {
      text: `${PARAMS.details}\n\`\`\`\nrm -rf *\ngit push\n\`\`\``,
      textSyntax: 'MARKDOWN',
    },
  });
});

it('falls back to passthrough when codeDetails is empty', () => {
  const p = buildCardPayload({ ...PARAMS, codeBlock: true, codeDetails: '' });
  expect(p.cardsV2[0].card.sections[0].widgets[1]).toEqual({
    textParagraph: { text: PARAMS.details, textSyntax: 'MARKDOWN' },
  });
});

it('pads the fence beyond backtick runs in codeDetails', () => {
  const p = buildCardPayload({
    ...PARAMS,
    codeBlock: true,
    codeDetails: 'inline `code` and a ```run``` inside',
  });
  expect(p.cardsV2[0].card.sections[0].widgets[1]).toEqual({
    textParagraph: {
      text: `${PARAMS.details}\n\`\`\`\`\ninline \`code\` and a \`\`\`run\`\`\` inside\n\`\`\`\``,
      textSyntax: 'MARKDOWN',
    },
  });
});

it('sends the payload as JSON to the webhook', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  global.fetch = fetchMock as unknown as typeof fetch;
  await sendCard('https://chat.example/hook', buildCardPayload(PARAMS));
  expect(fetchMock).toHaveBeenCalledWith('https://chat.example/hook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: expect.stringContaining('"cardsV2"'),
  });
});

it('logs non-ok responses and resolves', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
  }) as unknown as typeof fetch;
  const err = jest.spyOn(console, 'error').mockImplementation();
  await expect(
    sendCard('https://x/hook', buildCardPayload(PARAMS)),
  ).resolves.toBeUndefined();
  expect(err).toHaveBeenCalledWith(
    '[gchat-notify] Webhook error: 403 Forbidden',
  );
});

it('logs and swallows network errors', async () => {
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
  const err = jest.spyOn(console, 'error').mockImplementation();
  await expect(
    sendCard('https://x/hook', buildCardPayload(PARAMS)),
  ).resolves.toBeUndefined();
  expect(err).toHaveBeenCalledWith(
    '[gchat-notify] Failed to send notification:',
    expect.any(Error),
  );
});
