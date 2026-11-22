import { basename } from 'node:path';
// eslint-disable-next-line import/no-unresolved -- resolved via tsconfig "paths" (package is exports-only, no "main")
import { Plugin } from '@opencode/plugin';
import { resolveConfig } from './config';
import { buildCardPayload, sendCard } from './google-chat';
import { Notifier } from './notifier';

export default Plugin.define({
  id: 'gchat-notify',
  async setup(ctx) {
    const config = resolveConfig(
      ctx.options as Record<string, unknown>,
      process.env,
    );
    if (!config.webhookUrl) {
      // eslint-disable-next-line no-console -- a plugin's only logging channel
      console.log(
        '[gchat-notify] No webhook URL configured (options.webhookUrl or OPENCODE_GCHAT_WEBHOOK_URL); notifications disabled',
      );
      return;
    }
    const { webhookUrl } = config;
    const projectName = basename(ctx.location.directory);

    const notifier = new Notifier({
      config,
      projectName,
      locationDirectory: ctx.location.directory,
      now: () => Date.now(),
      getSession: async (sessionID) => {
        try {
          const session = await ctx.session.get({ sessionID });
          return {
            parentID: session.parentID,
            title: session.title,
            location: session.location
              ? { directory: session.location.directory }
              : undefined,
          };
        } catch {
          return undefined;
        }
      },
      send: async (request) => {
        try {
          await sendCard(
            webhookUrl,
            buildCardPayload({ ...request, projectName }),
          );
        } catch (error) {
          // eslint-disable-next-line no-console -- a plugin's only logging channel
          console.error('[gchat-notify]', error);
        }
      },
    });

    const controller = new AbortController();
    const consume = async (): Promise<void> => {
      // eslint-disable-next-line no-restricted-syntax -- for-await is the idiomatic async-iterator consumption
      for await (const event of ctx.event.subscribe({
        types: [
          'session.execution.started',
          'session.execution.succeeded',
          'session.execution.failed',
          'session.execution.interrupted',
          'permission.asked',
        ],
        signal: controller.signal,
      })) {
        switch (event.type) {
          case 'session.execution.started':
            notifier.onExecutionStarted(event.data.sessionID);
            break;
          case 'session.execution.succeeded':
            await notifier.onIdle(event.data.sessionID);
            break;
          case 'session.execution.failed':
            await notifier.onFailed(event.data.sessionID, event.data.error);
            break;
          case 'session.execution.interrupted':
            await notifier.onInterrupted(
              event.data.sessionID,
              event.data.reason,
            );
            break;
          case 'permission.asked':
            await notifier.onPermissionAsked(
              event.data.sessionID,
              event.data.action,
              event.data.resources,
            );
            break;
          default:
            break;
        }
      }
    };
    consume().catch((error: unknown) => {
      // eslint-disable-next-line no-console -- a plugin's only logging channel
      console.error('[gchat-notify] Event stream failed:', error);
    });

    const toolRegistration = await ctx.tool.hook('execute.before', (event) => {
      if (event.tool !== 'question') return;
      try {
        const input = event.input as
          | { questions?: Array<{ question?: string }> }
          | undefined;
        notifier.onQuestion(event.sessionID, input?.questions ?? []);
      } catch (error) {
        // eslint-disable-next-line no-console -- a plugin's only logging channel
        console.error('[gchat-notify]', error);
      }
    });

    // eslint-disable-next-line consistent-return -- plugin API: cleanup is returned only when active
    return () => {
      controller.abort();
      toolRegistration.dispose().catch(() => undefined);
    };
  },
});
