/**
 * Heuristics for tasks that need multiple tools or a full ReAct loop even when the user
 * does not use explicit chain words ("and then", "luego", …).
 *
 * Multilingual note: patterns are largely Spanish/English lexical; same intent in other
 * languages may not match (Classifier + AmplifierLoop both call this — see Classifier.ts header).
 */
export function impliesMultiToolWorkflow(message: string): boolean {
  const n = message.toLowerCase();
  if (/\b(and then|luego|despu[eé]s|con el resultado|y luego|y guarda|y crea|y escribe|y resume)\b/i.test(n)) {
    return true;
  }

  const webish = /\b(busca|search|lookup|look up|google|en internet)\b/i.test(n);
  const fileWrite = /\b(crea|create|write|guarda|save|escribe|archivo|file|\.md|\.txt|\.json)\b/i.test(n);
  if (webish && fileWrite) {
    return true;
  }

  const readish = /\b(read|reading|lee|leer|open|abre)\b/i.test(n) || /\blee\s+(el|la|los|las)\s+/i.test(n);
  const summarizeWrite =
    /\b(summary|summarize|resumen|resume|extract|extrae|guarda en|save to|write to|escribe en|nuevo archivo)\b/i.test(n);
  if (readish && summarizeWrite) {
    return true;
  }

  if (/\b(analyze|analyse|analiza|review|revisa)\b/i.test(n) && /\b(and|y)\s+(summarize|resume|report|guarda|save)\b/i.test(n)) {
    return true;
  }

  return false;
}
