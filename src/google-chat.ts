export interface GoogleChatCardPayload {
  text: string;
  cardsV2: Array<{
    cardId: string;
    card: {
      header: {
        title: string;
        subtitle: string;
      };
      sections: Array<{
        widgets: Array<
          | {
              decoratedText: {
                topLabel: string;
                text: string;
                wrapText?: boolean;
              };
            }
          | { textParagraph: { text: string; textSyntax: 'MARKDOWN' } }
        >;
      }>;
    };
  }>;
}

export interface CardParams {
  readonly badge: string;
  readonly title: string;
  readonly sessionTitle: string;
  readonly details: string;
  readonly timestamp: string;
  readonly codeBlock?: boolean;
  readonly codeDetails?: string;
}

function fenceCodeBlock(details: string): string {
  const longestRun =
    details.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ??
    0;
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${details}\n${fence}`;
}

export function buildCardPayload(
  params: CardParams & { readonly projectName: string },
): GoogleChatCardPayload {
  return {
    text: `${params.badge} [${params.projectName}] ${params.title}`,
    cardsV2: [
      {
        cardId: `opencode-${Date.now()}`,
        card: {
          header: {
            title: params.title,
            subtitle: `Project: ${params.projectName} • ${params.timestamp}`,
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Session',
                    text: params.sessionTitle,
                  },
                },
                params.codeBlock
                  ? {
                      textParagraph: {
                        text: params.codeDetails
                          ? `${params.details}\n${fenceCodeBlock(params.codeDetails)}`
                          : params.details,
                        textSyntax: 'MARKDOWN' as const,
                      },
                    }
                  : {
                      decoratedText: {
                        topLabel: 'Details',
                        text: params.details,
                        wrapText: true,
                      },
                    },
              ],
            },
          ],
        },
      },
    ],
  };
}

export async function sendCard(
  webhookUrl: string,
  payload: GoogleChatCardPayload,
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console -- a plugin's only logging channel
      console.error(
        `[gchat-notify] Webhook error: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console -- a plugin's only logging channel
    console.error('[gchat-notify] Failed to send notification:', error);
  }
}
