type TypingCapableContext = {
  sendChatAction(action: 'typing'): Promise<unknown>;
};

const TYPING_REFRESH_MS = 4000;

export type TypingSession = {
  stop: () => void;
};

export function startTyping(ctx: TypingCapableContext): TypingSession {
  let interval: NodeJS.Timeout | undefined;
  let stopped = false;

  const sendTyping = () => {
    ctx.sendChatAction('typing').catch((error) => {
      console.warn('[Telegram] Failed to send typing indicator:', error);
    });
  };

  // Trigger immediately so users see feedback right away.
  sendTyping();
  interval = setInterval(sendTyping, TYPING_REFRESH_MS);

  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
    },
  };
}
