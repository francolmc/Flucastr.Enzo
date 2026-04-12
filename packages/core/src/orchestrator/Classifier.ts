import { LLMProvider, Message } from '../providers/types.js';
import { ClassificationResult, ComplexityLevel } from './types.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';

export class Classifier {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async classify(message: string, history: Message[]): Promise<ClassificationResult> {
    // Fast-path: mensajes triviales no necesitan llamada al LLM
    const trivialPattern = /^(hola|hello|hi|hey|buenos días|buenas|good morning|gracias|thanks|ok|sí|no|chao|bye|adiós)[.!?]?$/i;
    if (trivialPattern.test(message.trim())) {
      console.log('[Classifier] Fast-path trivial → SIMPLE');
      return { level: ComplexityLevel.SIMPLE, reason: 'trivial message' };
    }

    const systemPrompt = `You are a task complexity classifier. Respond ONLY with JSON, no extra text.

{"level":"SIMPLE","reason":"..."}
{"level":"MODERATE","reason":"..."}
{"level":"COMPLEX","reason":"..."}

LEVELS — apply in order, first match wins:

SIMPLE — direct conversation, no tools needed:
- Greetings: "hello", "hi", "good morning", "how are you"
- Knowledge questions answerable from memory: "what is X", "how does Y work", "what time is it"
- Casual conversation, confirmations, thank you, follow-ups
- Math: "2+2", "what is 15% of 200"
- Anything answerable without external data or file access

MODERATE — needs exactly ONE tool:
- Web search: "search for...", "look up...", "what does the web say about...", "busca..."
- File operations: "read file...", "show contents of...", "list folder...", "create file..."
- Single command execution
- Personal statements to remember: "my name is...", "I am a...", "I live in...", "soy..."
  These are ALWAYS MODERATE (save to memory), never COMPLEX
- Save or remember a single fact: "remember that...", "my name is Franco"
  Even if it contains "and": "I am a developer and I live in Copiapó" = MODERATE
- Queries about CURRENT system state (RAM, disk, processes, OS version, CPU usage)
  These REQUIRE execute_command — never classify as SIMPLE (model doesn't know real system state)
- Call an HTTP/API endpoint when the user provides a URL → execute_command with curl

COMPLEX — when there are 2 or more chained actions, OR when reorganizing/moving multiple files:
- "search X and then create a file with the result"
- "read file Y and summarize it into a new file Z"
- "look up X, then save what you find to a file"
- Moving/organizing multiple files or folders into a new location (requires mkdir + mv)
- "move those folders to X", "put those files in a new folder", "meter esas carpetas en X", "organiza esas carpetas"
- Tasks where you explicitly need to do action A THEN use its output for action B
- NEVER COMPLEX for simple personal statements, even if they contain "and"
  "I am a developer and I live in X" = MODERATE (two facts to remember, not chained actions)

CRITICAL RULES:
- When in doubt, check for action verbs (buscar, crear, leer, guardar, search, create, read, save). If present → MODERATE
- When truly in doubt with no action verbs → SIMPLE
- A greeting is ALWAYS SIMPLE, never MODERATE or COMPLEX
- One search OR one file operation = MODERATE, never COMPLEX
- COMPLEX requires explicit chaining ("and then", "luego", "después", "with the result")
- COMPLEX is the exception, not the rule

Examples:
"hola" → {"level":"SIMPLE","reason":"greeting"}
"what is the Atacama Desert?" → {"level":"SIMPLE","reason":"knowledge question"}
"search for AI news" → {"level":"MODERATE","reason":"single web search"}
"list my Downloads folder" → {"level":"MODERATE","reason":"single file operation"}
"remember that my name is Franco" → {"level":"MODERATE","reason":"single remember action"}
"I am a developer and I live in Copiapó" → {"level":"MODERATE","reason":"personal statement with facts to remember, not chained actions"}
"¿cuánta RAM libre tengo?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"¿qué versión de macOS tengo?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"¿cuánto espacio libre hay en disco?" → {"level":"MODERATE","reason":"system state query requiring execute_command"}
"consulta https://api.github.com/users/octocat" → {"level":"MODERATE","reason":"single curl API call"}
"search what is the Atacama Desert and then create a file with a summary" → {"level":"COMPLEX","reason":"chained: search then write file"}
"read file X and save a summary to file Y" → {"level":"COMPLEX","reason":"chained: read then write"}
"move those folders to IntroProgra" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv multiple items"}
"meter esas carpetas en una carpeta nueva" → {"level":"COMPLEX","reason":"reorganize: requires mkdir + mv"}
"llama a https://api.x.com/data y guárdalo en un archivo" → {"level":"COMPLEX","reason":"chained: curl API call then write file"}

ONLY JSON. NOTHING ELSE.`;

    const messages: Message[] = [
      ...history.slice(-4),
      { role: 'user', content: message },
    ];

    try {
      const parsed = await this.requestClassification(systemPrompt, messages);
      if (!parsed) {
        return this.fallbackClassification(message, 'Classification JSON parse failed');
      }

      const level = Object.values(ComplexityLevel).includes(parsed.level)
        ? parsed.level
        : ComplexityLevel.SIMPLE;

      return {
        level,
        reason: parsed.reason || 'No reason provided',
      };
    } catch (error) {
      console.error('Classifier.classify() error:', error);
      return this.fallbackClassification(message, 'Classification failed due to error');
    }
  }

  private hasActionVerb(message: string): boolean {
    return /\b(search|look up|read|write|create|save|list|execute|run|call|fetch|remember|summary?|summari(?:ze|s(?:e|ing)?)?|analy(?:ze|sis|zing)?|busca(?:r)?|lee(?:r)?|leer|escrib(?:e|ir)|crear|guardar|listar|ejecutar|llamar|consultar|resum(?:e|en|ir|elo|ela|elos|elas)?|analiz(?:ar|a|o)|extra(?:er|e|igo)?)\b/i.test(
      message
    );
  }

  private fallbackClassification(message: string, reason: string): ClassificationResult {
    const level = this.hasActionVerb(message) ? ComplexityLevel.MODERATE : ComplexityLevel.SIMPLE;
    console.warn(`[Classifier] ${reason}. Falling back to ${level}.`);
    return {
      level,
      reason,
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
