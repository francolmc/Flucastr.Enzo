const currentConversationByUser = new Map<string, string>();

function defaultConversationId(userId: string): string {
  return `telegram_${userId}`;
}

export function getCurrentConversationId(userId: string): string {
  return currentConversationByUser.get(userId) || defaultConversationId(userId);
}

export function startNewConversation(userId: string): string {
  const conversationId = `telegram_${userId}_${Date.now()}`;
  currentConversationByUser.set(userId, conversationId);
  return conversationId;
}

export function clearCurrentConversation(userId: string): void {
  currentConversationByUser.delete(userId);
}
