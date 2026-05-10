/**
 * Returns true when the message contains explicit chain connectors that signal a
 * multi-step workflow regardless of language (structural signal, not keyword matching).
 *
 * Semantic multi-tool detection (intent without chain words) is delegated to the LLM Classifier.
 */
export function impliesMultiToolWorkflow(message: string): boolean {
  return /\band then\b/i.test(message);
}
