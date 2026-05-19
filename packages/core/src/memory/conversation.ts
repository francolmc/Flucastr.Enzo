export interface Turn {
  userMessage: string;
  enzoResponse: string;
  timestamp: number;
  keywords: string[];
}

export interface ConversationMemory {
  save(userMessage: string, enzoResponse: string): void;
  getRelevant(currentMessage: string, maxTurns?: number): string;
  getRelevantForUnderstand(currentMessage: string): string;
  getLastTurnResults(): string[];
  getAllTurnResults(): string[];
}

export function createConversationMemory(): ConversationMemory {
  const turns: Turn[] = [];

  function extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .map(w => w.replace(/[^a-záéíóúñ]/g, ''))
      .filter(w => w.length > 3);
  }

  function scoreRelevance(turn: Turn, currentMessage: string): number {
    const currentKeywords = new Set(extractKeywords(currentMessage));
    const matches = turn.keywords.filter(k => currentKeywords.has(k)).length;
    return matches / Math.max(currentKeywords.size, 1);
  }

  return {
    save(userMessage, enzoResponse) {
      turns.push({
        userMessage,
        enzoResponse,
        timestamp: Date.now(),
        keywords: extractKeywords(userMessage + ' ' + enzoResponse),
      });

      if (turns.length > 20) turns.shift();
    },

    getRelevant(currentMessage, maxTurns = 3) {
      if (turns.length === 0) return '';

      const lastTurn = turns[turns.length - 1];

      const previous = turns.slice(0, -1);
      const scored = previous
        .map(t => ({ turn: t, score: scoreRelevance(t, currentMessage) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxTurns - 1)
        .map(x => x.turn);

      const selected = [...scored, lastTurn];

      return selected
        .map(t => `User: ${t.userMessage}\nEnzo: ${t.enzoResponse}`)
        .join('\n\n');
    },

    getRelevantForUnderstand(currentMessage) {
      if (turns.length === 0) return '';

      const recent = turns.slice(-2);

      return recent
        .map(t => `User: ${t.userMessage}`)
        .join('\n');
    },

    getLastTurnResults() {
      if (turns.length === 0) return [];
      const lastTurn = turns[turns.length - 1];
      return [lastTurn.enzoResponse];
    },

    getAllTurnResults() {
      return turns.map(t => t.enzoResponse);
    },
  };
}