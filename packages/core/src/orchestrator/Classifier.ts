/**
 * Complexity routing (`SIMPLE` | `MODERATE` | `COMPLEX`):
 *
 * 1. Optional bypass: when `process.env.ENZO_CLASSIFIER_LLM_ALWAYS === 'true'`, skip all heuristic
 *    fast-paths below and classify only via LLM (+ history in `messages`). Logs `classifierBranch: llm_always`.
 *
 * 2. Heuristic ordered fast-paths (cheap; ESLint many are ES/EN-lexical — multilingual gap, see multilingual audit below):
 *    - trivial greeting / short acknowledgement (`trivialPattern`)
 *    - recall / pending wording (`isLikelyRecallQuery`) → MODERATE
 *    - abstract life planning without filesystem path (`isLikelyAbstractLifePlanningWithoutPaths`) → SIMPLE
 *    - explicit chain phrases (`isLikelyChainedTask`) → COMPLEX
 *    - implicit multi-tool patterns (`impliesMultiToolWorkflow` from taskRoutingHints) → COMPLEX
 *    - persist file at absolute path (`messageIndicatesPersistedWriteToAbsolutePath`) → MODERATE + classifierBranch `write_file_lexical_hint`
 *    - factual / temporal lexical lists (`isLikelyFactualQuery`) → MODERATE + suggestedTool web_search
 *    - single-tool lexical cues (`isLikelySingleToolTask`) → MODERATE
 *
 * 3. If no heuristic matches → LLM JSON classifier (`requestClassification`).
 *
 * 4. On LLM JSON parse failure → `fallbackClassification` uses `hasActionVerb` → logs `fallback`.
 *
 * Multilingual audit (high level — lexical heuristics do not adapt to PT/FR/de/zh/…):
 * - Classifier: trivialPattern; isLikelyRecallQuery; isLikelyAbstractLifePlanningWithoutPaths; isLikelyChainedTask;
 *   isLikelyFactualQuery word lists; isLikelySingleToolTask; hasActionVerb.
 * - taskRoutingHints.impliesMultiToolWorkflow: ES/EN chain + web/read/write combinators only.
 * - More locale-agnostic cues (used only inside helpers): absolute path shapes in messageContainsLikelyAbsolutePath,
 *   file extensions in impliesMultiToolWorkflow (\\.md etc.).
 *
 * Duplicate gate: AmplifierLoop.amplify re-runs impliesMultiToolWorkflow on the raw user message even after
 * Classifier returned SIMPLE/MODERATE — intentional second line of defense before runSimpleModerateFastPath.
 */
import { LLMProvider, Message } from '../providers/types.js';
import { ClassificationResult, ComplexityLevel } from './types.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';
import { impliesMultiToolWorkflow } from './taskRoutingHints.js';

function logClassifierRouting(branch: string, level: ComplexityLevel): void {
  console.log(JSON.stringify({ event: 'EnzoRouting', classifierBranch: branch, level }));
}

/** True if the message likely contains a concrete absolute path the shell should use. */
export function messageContainsLikelyAbsolutePath(message: string): boolean {
  if (/(?:^|\s|["'])(\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|usr|root)\b\/[\S]*)/i.test(message)) {
    return true;
  }
  if (/(?:^|\s|["'])([A-Za-z]:\\[^\s]+)/.test(message)) {
    return true;
  }
  if (/(?:^|\s|["'])(\/[\w.-]+(?:\/[\w.-]+)+)(?:\s|$|[,'"`])/m.test(message)) {
    return true;
  }
  return false;
}

/** JS \\w / \\b do not treat letters with diacritics as word chars — match creá with explicit delimiters when needed. */
function messageHasLikelyPersistWriteIntentLexical(text: string): boolean {
  const delimiterStart = '(?:^|[\\s.,;:!?¿¡(\'"«])';
  if (
    new RegExp(`${delimiterStart}c[rR]e[ÁáAa](?=\\s|[.,!?;:]|$|\\))`, 'u').test(text) ||
    new RegExp(`${delimiterStart}c[rR]ea(?=\\s|[.,!?;:]|$|\\))`, 'u').test(text)
  ) {
    return true;
  }
  return /\b(?:crear|crea\b|cré(?:e|a)me|create|creating|writes?\b|write|writing|guardar|guarda|save|saving|overwrite|touch|escrib(?:e|í|íbeme|imos|iendo)?|guárdalo|guardalo|save\s+to|write\s+to|generar\s+(?:un\s+)?archivo|nuevo\s+archivo)\b/i.test(
    text
  );
}

function messageLooksReadOnlyNoWriteIntentLexical(text: string): boolean {
  return /\b(?:leer|lee(?:r|me)?|read(?:ing)?|muestra(?:me)?|show\s+me\s+the|contenido\s+de|cat\s+)\b/i.test(text) && !messageHasLikelyPersistWriteIntentLexical(text);
}

/** True when the message likely asks to CREATE/WRITE/SAVE file content at that path (lexical ES/EN). Exported for AmplifierLoop / fast path. */
export function messageIndicatesPersistedWriteToAbsolutePath(message: string): boolean {
  const trimmed = message.trim();
  if (!messageContainsLikelyAbsolutePath(trimmed)) {
    return false;
  }
  if (messageLooksReadOnlyNoWriteIntentLexical(trimmed)) {
    return false;
  }
  return messageHasLikelyPersistWriteIntentLexical(trimmed);
}

export class Classifier {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async classify(message: string, history: Message[]): Promise<ClassificationResult> {
    const normalizedMessage = message.trim();
    const llmAlways = process.env.ENZO_CLASSIFIER_LLM_ALWAYS === 'true';

    const systemPrompt = this.buildClassifierSystemPrompt();
    const messages: Message[] = [...history, { role: 'user', content: message }];

    if (llmAlways) {
      console.log('[Classifier] ENZO_CLASSIFIER_LLM_ALWAYS — skipping lexical fast-paths');
      return await this.runLlmClassification(systemPrompt, messages, normalizedMessage, true);
    }

    const trivialPattern = /^(hola|hello|hi|hey|buenos días|buenas|good morning|gracias|thanks|ok|sí|no|chao|bye|adiós)[.!?]?$/i;
    if (trivialPattern.test(normalizedMessage)) {
      console.log('[Classifier] Fast-path trivial → SIMPLE');
      logClassifierRouting('trivial', ComplexityLevel.SIMPLE);
      return { level: ComplexityLevel.SIMPLE, reason: 'trivial message', classifierBranch: 'trivial' };
    }
    if (this.isLikelyRecallQuery(normalizedMessage.toLowerCase())) {
      console.log('[Classifier] Fast-path recall query → MODERATE');
      logClassifierRouting('recall_lexical', ComplexityLevel.MODERATE);
      return { level: ComplexityLevel.MODERATE, reason: 'recall query — needs RecallTool', classifierBranch: 'recall_lexical' };
    }
    if (this.isLikelyAbstractLifePlanningWithoutPaths(normalizedMessage)) {
      console.log('[Classifier] Fast-path life/task planning (no paths) → SIMPLE');
      logClassifierRouting('life_planning_no_path', ComplexityLevel.SIMPLE);
      return {
        level: ComplexityLevel.SIMPLE,
        reason: 'abstract task or daily planning without concrete file paths',
        classifierBranch: 'life_planning_no_path',
      };
    }
    if (this.isLikelyChainedTask(normalizedMessage)) {
      logClassifierRouting('chained_explicit_lexical', ComplexityLevel.COMPLEX);
      return { level: ComplexityLevel.COMPLEX, reason: 'detected explicit chained workflow', classifierBranch: 'chained_explicit_lexical' };
    }
    if (impliesMultiToolWorkflow(normalizedMessage)) {
      logClassifierRouting('multi_tool_implicit_classifier', ComplexityLevel.COMPLEX);
      return { level: ComplexityLevel.COMPLEX, reason: 'implicit multi-tool workflow', classifierBranch: 'multi_tool_implicit_classifier' };
    }
    if (messageIndicatesPersistedWriteToAbsolutePath(normalizedMessage)) {
      logClassifierRouting('write_file_lexical_hint', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason:
          'create or persist file content at an absolute host path — requires write_file (never plain chat claiming the file exists)',
        classifierBranch: 'write_file_lexical_hint',
      };
    }
    if (this.isLikelyFactualQuery(normalizedMessage)) {
      console.log('[Classifier] Fast-path factual query → MODERATE');
      logClassifierRouting('factual_lexical', ComplexityLevel.MODERATE);
      return {
        level: ComplexityLevel.MODERATE,
        reason: 'Real-world factual query that requires web search for accurate answer',
        suggestedTool: 'web_search',
        classifierBranch: 'factual_lexical',
      };
    }
    if (this.isLikelySingleToolTask(normalizedMessage)) {
      logClassifierRouting('single_tool_lexical', ComplexityLevel.MODERATE);
      return { level: ComplexityLevel.MODERATE, reason: 'detected single-tool intent', classifierBranch: 'single_tool_lexical' };
    }

    return await this.runLlmClassification(systemPrompt, messages, normalizedMessage, false);
  }

  private async runLlmClassification(
    systemPrompt: string,
    messages: Message[],
    normalizedMessage: string,
    fromLlmAlwaysBypass: boolean
  ): Promise<ClassificationResult> {
    try {
      const parsed = await this.requestClassification(systemPrompt, messages);
      if (!parsed) {
        return this.fallbackClassification(normalizedMessage, 'Classification JSON parse failed');
      }

      const level = Object.values(ComplexityLevel).includes(parsed.level)
        ? parsed.level
        : ComplexityLevel.SIMPLE;

      const llmBranch = fromLlmAlwaysBypass ? 'llm_always' : 'llm';
      logClassifierRouting(llmBranch, level);
      return {
        level,
        reason: parsed.reason || 'No reason provided',
        classifierBranch: llmBranch,
      };
    } catch (error) {
      console.error('Classifier.classify() error:', error);
      return this.fallbackClassification(normalizedMessage, 'Classification failed due to error');
    }
  }

  private buildClassifierSystemPrompt(): string {
    return `You are a task complexity classifier. Respond ONLY with JSON, no extra text.
The user's message may be in ANY natural language — infer intent regardless of language; map to level using the SAME rules below.

{"level":"SIMPLE","reason":"..."}
{"level":"MODERATE","reason":"..."}
{"level":"COMPLEX","reason":"..."}

LEVELS — apply in order, first match wins:

SIMPLE — direct conversation, no tools needed:
- Greetings: "hello", "hi", "good morning", "how are you"
- Casual conversation, confirmations, thank you, follow-ups — when the user does not ask for filesystem work, URLs, searches, measurable facts about the outside world, system metrics, persistent memory/recall, or other tool-backed actions on this machine
- Conceptual or math without external or verifiable data: "how does Y work" (in general), "2+2", "what is 15% of 200" — not real-world facts that may be wrong if outdated (those are MODERATE, web search)
- Anything answerable without tools, file access, or up-to-date web facts
- Planning / coaching / lists: "help me manage my day", "daily routine tips", "how should I organize my tasks" when the user did NOT give a concrete absolute folder path to operate on
- Spanish: "gestión del día a día", "gestionar tareas personales", "necesito organizar mi tiempo" without a path like /home/... or /Users/...

MODERATE — needs exactly ONE tool:
- Web search: "search for...", "look up...", "what does the web say about...", "busca..."
- Real-world facts that may be outdated or require verification: current prices, exchange rates, weather, news, recent events, status of a person/company/project, sports results, release dates, any question about "now", "today", "currently", "latest", "recent"
- Factual questions where being wrong would mislead the user: "who is the CEO of X", "what is the population of Y", "how much does Z cost", "what happened with W"
- File operations: "read file...", "show contents of...", "list folder...", "create file..."
- **CRITICAL — never SIMPLE:** If the user asks to create, overwrite, or save **new/original content** to a **concrete absolute file path** on this machine (e.g. \`/home/.../file.md\`, \`/Users/.../x.txt\`, \`C:\\\\...\\\\out.md\`), that is **always MODERATE** — it requires \`write_file\` (a side effect on disk), even when the content is creative (a story, poem, invented text). Never classify that as SIMPLE.
- Sending or sharing an existing file to the user via Telegram: "mandame el archivo...", "compartí el reporte", "enviame lo que generaste", "send me the file..." — needs send_file
- Single command execution
- Personal statements to remember: "my name is...", "I am a...", "I live in...", "soy..."
  These are ALWAYS MODERATE (save to memory), never COMPLEX
- Save or remember a single fact: "remember that...", "my name is Franco"
  Even if it contains "and": "I am a developer and I live in Copiapó" = MODERATE
- Queries about CURRENT system state (RAM, disk, processes, OS version, CPU usage)
  These REQUIRE execute_command — never classify as SIMPLE (model doesn't know real system state)
- Call an HTTP/API endpoint when the user provides a URL → execute_command with curl
- Questions about what the user has pending, captured, or said before are MODERATE — they need RecallTool, not web search.

COMPLEX — when there are 2 or more chained actions, OR when reorganizing/moving multiple files:
- "search X and then create a file with the result"
- "read file Y and summarize it into a new file Z"
- "look up X, then save what you find to a file"
- Moving/organizing multiple files or folders into a new location (requires mkdir + mv) when the user points to REAL paths or files to move
- "move those folders to X", "put those files in a new folder", "meter esas carpetas en X", "organiza esas carpetas" (with concrete /path or clearly referenced files)
- NOT COMPLEX for abstract life/task planning without paths — that is SIMPLE (conversation only)
- Tasks where you explicitly need to do action A THEN use its output for action B
- NEVER COMPLEX for simple personal statements, even if they contain "and"
  "I am a developer and I live in X" = MODERATE (two facts to remember, not chained actions)

CRITICAL RULES:
- Creating or overwriting a file at a path the user specified = MODERATE (\`write_file\`), **never** SIMPLE — do not treat it as "just chat" because the model could output the text in prose without writing disk
- Decide from meaning: SIMPLE when no single tool-backed action fits; MODERATE when exactly one such action fits; COMPLEX when multiple chained actions fit
- When truly in doubt with nothing that requires tools → SIMPLE
- A greeting is ALWAYS SIMPLE, never MODERATE or COMPLEX
- One search OR one file operation = MODERATE, never COMPLEX
- COMPLEX requires explicit chaining ("and then", "luego", "después", "with the result")
- COMPLEX is the exception, not the rule

Examples:
"hola" → {"level":"SIMPLE","reason":"greeting"}
"hola cómo estás?" → {"level":"SIMPLE","reason":"greeting"}
"cuánto es 15% de 200?" → {"level":"SIMPLE","reason":"math calculation"}
"what is the Atacama Desert?" → {"level":"MODERATE","reason":"factual question requiring web search"}
"search for AI news" → {"level":"MODERATE","reason":"single web search"}
"list my Downloads folder" → {"level":"MODERATE","reason":"single file operation"}
"remember that my name is Franco" → {"level":"MODERATE","reason":"single remember action"}
"I am a developer and I live in Copiapó" → {"level":"MODERATE","reason":"personal statement with facts to remember, not chained actions"}
"¿cuánta RAM libre tengo?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"¿qué versión de macOS tengo?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"¿cuánto espacio libre hay en disco?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"consulta https://api.github.com/users/octocat" → {"level":"MODERATE","reason":"single curl API call"}
"mandame el archivo informe.docx que está en Descargas" → {"level":"MODERATE","reason":"send_file tool"}
"compartí el reporte" → {"level":"MODERATE","reason":"send_file tool"}
"enviame lo que generaste" → {"level":"MODERATE","reason":"send_file tool"}
"¿qué tengo pendiente de Dash?" → {"level":"MODERATE","reason":"recall query — needs RecallTool"}
"¿recordás lo que dijimos del PR?" → {"level":"MODERATE","reason":"recall query — needs RecallTool"}
"search what is the Atacama Desert and then create a file with a summary" → {"level":"COMPLEX","reason":"chained: search then write file"}
"read file X and save a summary to file Y" → {"level":"COMPLEX","reason":"chained: read then write"}
"move those folders to IntroProgra" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv multiple items"}
"meter esas carpetas en una carpeta nueva" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv"}
"llama a https://api.x.com/data y guárdalo en un archivo" → {"level":"COMPLEX","reason":"chained: curl API call then write file"}
"necesito gestionar tareas personales y de todos mis trabajos" → {"level":"SIMPLE","reason":"planning conversation, no concrete paths or file ops"}
"ayuda con la gestión de mi día a día" → {"level":"SIMPLE","reason":"coaching/planning without shell or paths"}
"creá el archivo /home/franco/historia.md con una historia corta" → {"level":"MODERATE","reason":"create file at concrete path requires write_file"}
"please write a README to /tmp/readme-test.md with install steps" → {"level":"MODERATE","reason":"persist new content at absolute path"}

ONLY JSON. NOTHING ELSE.`;
  }

  /**
   * Task/life planning in natural language without a filesystem path — should stay conversational (SIMPLE).
   */
  private isLikelyAbstractLifePlanningWithoutPaths(message: string): boolean {
    if (messageContainsLikelyAbsolutePath(message)) {
      return false;
    }
    const n = message.toLowerCase();
    const planningPhrase =
      /\b(gesti[oó]n\s+(del\s+)?d[ií]a|gesti[oó]n\s+de\s+(mi|tu|su)\s+d[ií]a|gesti[oó]n\s+.*\bd[ií]a\s+a\s+d[ií]a|d[ií]a\s+a\s+d[ií]a|gestionar\s+(mis\s+)?tareas|rutinas?\s+diarias?|recordatorios|pomodoro|planificaci[oó]n\s+personal|ay[úu]dame\s+a\s+organizar\s+mi\s+d[ií]a|ayuda\s+con\s+(la\s+)?gesti[oó]n|help\s+me\s+(manage|plan)\s+(my\s+)?(tasks|day)|daily\s+planning|task\s+management)\b/i.test(
        n
      );
    const spanishWorkLifeIntent =
      /\b(tareas?\s+personales|todos?\s+mis\s+trabajos|mis\s+trabajos)\b/i.test(n) &&
      /\b(gestionar|gesti[oó]n|organizar|necesito|ayuda)\b/i.test(n);
    return planningPhrase || spanishWorkLifeIntent;
  }

  private hasActionVerb(message: string): boolean {
    return /\b(search|look up|read|write|create|save|list|execute|run|call|fetch|remember|summary?|summari(?:ze|s(?:e|ing)?)?|analy(?:ze|sis|zing)?|busca(?:r)?|lee(?:r)?|leer|escrib(?:e|ir)|crear|guardar|listar|ejecutar|llamar|consultar|resum(?:e|en|ir|elo|ela|elos|elas)?|analiz(?:ar|a|o)|extra(?:er|e|igo)?)\b/i.test(
      message
    );
  }

  private isLikelySingleToolTask(message: string): boolean {
    const normalized = message.toLowerCase();
    const hasChainWords = /\b(and then|luego|despu[eé]s|con el resultado)\b/i.test(normalized);
    if (hasChainWords) return false;
    if (this.isLikelyRecallQuery(normalized)) {
      return true;
    }
    return /\b(read|lee|list|ls|search|busca|remember|recuerda|curl|consulta|version|ram|disk|disco)\b/i.test(normalized);
  }

  private isLikelyRecallQuery(normalized: string): boolean {
    return /(qu[eé] tengo pendiente|qu[eé] hay de|record[aá]s|qu[eé] dijimos de|qu[eé] capturaste|mis tareas|pendientes de)/i.test(
      normalized
    );
  }

  private isLikelyFactualQuery(message: string): boolean {
    const lower = message.toLowerCase();

    const temporalIndicators = [
      'ahora',
      'hoy',
      'actualmente',
      'último',
      'últimos',
      'última',
      'últimas',
      'reciente',
      'recientemente',
      'now',
      'today',
      'currently',
      'latest',
      'recent',
      'recently',
      'this year',
      'este año',
      'esta semana',
      'this week',
    ];

    const factualIndicators = [
      'precio',
      'costo',
      'cuánto cuesta',
      'cuánto vale',
      'price',
      'cost',
      'how much',
      'quién es',
      'quien es',
      'who is',
      'cuántos habitantes',
      'población',
      'population',
      'resultado',
      'resultado de',
      'score',
      'ganó',
      'perdió',
      'noticias',
      'news',
      'qué pasó',
      'what happened',
      'clima',
      'temperatura',
      'weather',
      'tipo de cambio',
      'dólar',
      'exchange rate',
      'ceo de',
      'ceo of',
      'presidente de',
      'president of',
    ];

    const hasTemporalIndicator = temporalIndicators.some((t) => lower.includes(t));
    const hasFactualIndicator = factualIndicators.some((t) => lower.includes(t));

    return hasTemporalIndicator || hasFactualIndicator;
  }

  private isLikelyChainedTask(message: string): boolean {
    const normalized = message.toLowerCase();
    return /\b(and then|luego|despu[eé]s|con el resultado|y luego|y guarda|y crea|y escribe|y resume)\b/i.test(normalized);
  }

  private fallbackClassification(message: string, reason: string): ClassificationResult {
    const level = this.hasActionVerb(message) ? ComplexityLevel.MODERATE : ComplexityLevel.SIMPLE;
    console.warn(`[Classifier] ${reason}. Falling back to ${level}.`);
    logClassifierRouting('fallback_action_verb_hint', level);
    return {
      level,
      reason,
      classifierBranch: 'fallback_action_verb_hint',
    };
  }

  private async requestClassification(
    systemPrompt: string,
    messages: Message[]
  ): Promise<{ level: ComplexityLevel; reason: string } | null> {
    const response = await this.provider.complete({
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.3,
      maxTokens: 256,
    });
    console.log('[Classifier] Raw response:', response.content);

    const allJsonMatches = extractJsonObjects(response.content);
    if (allJsonMatches.length > 1) {
      console.warn(`[Classifier] Model emitted ${allJsonMatches.length} JSON objects. Taking the first one.`);
    }

    const parsed = parseFirstJsonObject<{ level: ComplexityLevel; reason: string }>(response.content, {
      tryRepair: true,
    });
    if (parsed) {
      return parsed.value;
    }

    const retrySystemPrompt = `Return ONLY valid JSON with one object:
{"level":"SIMPLE|MODERATE|COMPLEX","reason":"short reason"}
No markdown, no prose.`;
    const retryResponse = await this.provider.complete({
      messages: [{ role: 'system', content: retrySystemPrompt }, ...messages],
      temperature: 0,
      maxTokens: 128,
    });
    console.log('[Classifier] Retry raw response:', retryResponse.content);

    const retryParsed = parseFirstJsonObject<{ level: ComplexityLevel; reason: string }>(
      retryResponse.content,
      { tryRepair: true }
    );

    return retryParsed ? retryParsed.value : null;
  }
}
