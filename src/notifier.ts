import type { ResolvedConfig } from './config';

export interface SessionSummary {
  readonly parentID?: string;
  readonly title?: string;
  readonly location?: { readonly directory: string };
}

export interface NotificationRequest {
  readonly badge: string;
  readonly title: string;
  readonly sessionTitle: string;
  readonly details: string;
  readonly timestamp: string;
  readonly codeBlock?: boolean;
  readonly codeDetails?: string;
}

export interface NotifierDeps {
  readonly config: ResolvedConfig;
  readonly projectName: string;
  readonly locationDirectory?: string;
  readonly now: () => number;
  readonly getSession: (
    sessionID: string,
  ) => Promise<SessionSummary | undefined>;
  readonly send: (request: NotificationRequest) => Promise<void>;
}

function sameLocationTree(
  sessionDirectory: string,
  pluginDirectory: string | undefined,
): boolean {
  if (!pluginDirectory) return true;
  return (
    sessionDirectory === pluginDirectory ||
    sessionDirectory.startsWith(`${pluginDirectory}/`) ||
    pluginDirectory.startsWith(`${sessionDirectory}/`)
  );
}

export class Notifier {
  private readonly busySince = new Map<string, number>();

  private readonly lastNotified = new Map<string, number>();

  private readonly lastOutcome = new Map<string, 'failed'>();

  constructor(private readonly deps: NotifierDeps) {}

  onExecutionStarted(sessionID: string): void {
    this.busySince.set(sessionID, this.deps.now());
    this.lastOutcome.delete(sessionID);
  }

  async onIdle(sessionID: string): Promise<void> {
    try {
      if (this.lastOutcome.get(sessionID) === 'failed') {
        this.lastOutcome.delete(sessionID);
        this.busySince.delete(sessionID);
        return;
      }
      const startedAt = this.busySince.get(sessionID);
      this.busySince.delete(sessionID);
      if (startedAt !== undefined && this.deps.config.minDurationSec > 0) {
        const elapsedMs = this.deps.now() - startedAt;
        if (elapsedMs < this.deps.config.minDurationSec * 1000) return;
      }
      const elapsedSec =
        startedAt !== undefined
          ? Math.max(1, Math.round((this.deps.now() - startedAt) / 1000))
          : null;
      const details = elapsedSec
        ? `Agent finished processing (${elapsedSec}s) and is ready for your next prompt.`
        : 'Agent finished processing and is ready for your next prompt.';
      await this.emit(`idle:${sessionID}`, sessionID, {
        badge: '✅',
        title: 'Task Completed',
        details,
      });
    } catch (error) {
      this.logFailure(error);
    }
  }

  async onFailed(
    sessionID: string,
    error: { readonly message?: string },
  ): Promise<void> {
    try {
      this.lastOutcome.set(sessionID, 'failed');
      await this.emit(`err:${sessionID}`, sessionID, {
        badge: '🛑',
        title: 'Session Interrupted',
        details: error.message || 'An unexpected error stopped execution.',
      });
    } catch (err) {
      this.logFailure(err);
    }
  }

  async onInterrupted(sessionID: string, reason: string): Promise<void> {
    try {
      this.lastOutcome.set(sessionID, 'failed');
      if (reason === 'user') return;
      await this.emit(`err:${sessionID}`, sessionID, {
        badge: '🛑',
        title: 'Session Interrupted',
        details: `Session was interrupted: ${reason}.`,
      });
    } catch (err) {
      this.logFailure(err);
    }
  }

  async onPermissionAsked(
    sessionID: string,
    action: string,
    resources: readonly string[],
  ): Promise<void> {
    try {
      const hasResources = resources.length > 0;
      await this.emit(`perm:${sessionID}`, sessionID, {
        badge: '⚠️',
        title: 'Approval Required',
        details: hasResources
          ? `Permission requested for ${action}:`
          : `Permission requested for ${action}.`,
        codeBlock: true,
        codeDetails: hasResources ? resources.join('\n') : undefined,
      });
    } catch (err) {
      this.logFailure(err);
    }
  }

  async onQuestion(
    sessionID: string,
    questions: readonly { readonly question?: string }[],
  ): Promise<void> {
    try {
      const first = questions[0]?.question;
      const details = first
        ? `OpenCode asked: "${first}"`
        : 'OpenCode is waiting for your answer to a clarification question.';
      await this.emit(`question:${sessionID}`, sessionID, {
        badge: '💬',
        title: 'User Input Needed',
        details,
      });
    } catch (err) {
      this.logFailure(err);
    }
  }

  /**
   * Resolves the session title to display, or null when the notification
   * should be dropped (sub-agent session, or session outside this location tree).
   */
  private async gate(sessionID: string): Promise<string | null> {
    let session: SessionSummary | undefined;
    try {
      session = await this.deps.getSession(sessionID);
    } catch {
      session = undefined;
    }
    if (!session) return sessionID.slice(0, 12);
    if (session.parentID) return null;
    const sessionDirectory = session.location?.directory;
    if (
      sessionDirectory &&
      !sameLocationTree(sessionDirectory, this.deps.locationDirectory)
    ) {
      return null;
    }
    return session.title || sessionID.slice(0, 12);
  }

  private passesDedupe(key: string): boolean {
    const now = this.deps.now();
    const previous = this.lastNotified.get(key);
    if (previous !== undefined && now - previous < this.deps.config.cooldownMs)
      return false;
    this.lastNotified.set(key, now);
    return true;
  }

  private async emit(
    key: string,
    sessionID: string,
    opts: {
      badge: string;
      title: string;
      details: string;
      codeBlock?: boolean;
      codeDetails?: string;
    },
  ): Promise<void> {
    const sessionTitle = await this.gate(sessionID);
    if (sessionTitle === null) return;
    if (!this.passesDedupe(key)) return;
    const timestamp = new Date(this.deps.now()).toLocaleTimeString(
      [],
      this.deps.config.timeZone
        ? {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: this.deps.config.timeZone,
            timeZoneName: 'short',
          }
        : { hour: '2-digit', minute: '2-digit' },
    );
    try {
      await this.deps.send({ sessionTitle, timestamp, ...opts });
    } catch (error) {
      this.logFailure(error);
    }
  }

  private logFailure(error: unknown): void {
    // eslint-disable-next-line no-console -- a plugin's only logging channel
    console.error('[gchat-notify]', error);
  }
}
