import { LLMProvider } from '../providers/types.js';
import type { Memory } from './types.js';
import { MemoryService } from './MemoryService.js';
import { normalizeMemoryKey } from './MemoryKeys.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';
import { recordMemoryExtract } from './MemoryMetrics.js';

export interface ExtractedFact {
  key: string;
  value: string;
  confidence?: number;
}

export class MemoryExtractor {
  private provider: LLMProvider;
  private memoryService: MemoryService;

  constructor(provider: LLMProvider, memoryService: MemoryService) {
    this.provider = provider;
    this.memoryService = memoryService;
  }

  /**
   * Extrae hechos de la conversación y los persiste en SQLite.
   * Se ejecuta en background — no bloquea la respuesta al usuario.
   */
  async extractAndSave(
    userId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<void> {
    try {
      const facts = await this.extract(userMessage, assistantResponse);

      if (facts.length === 0) {
        console.log('[MemoryExtractor] No facts to save from this conversation');
        recordMemoryExtract(true);
        return;
      }

      console.log(`[MemoryExtractor] Saving ${facts.length} fact(s) for user ${userId}`);

      for (const fact of facts) {
        const normalizedKey = normalizeMemoryKey(fact.key);
        const confidence = typeof fact.confidence === 'number' ? fact.confidence : 0.7;
        if (confidence < this.getConfidenceThreshold()) {
          console.log(`[MemoryExtractor] Skipping low-confidence fact "${normalizedKey}" (${confidence.toFixed(2)})`);
          continue;
        }
        await this.memoryService.remember(userId, normalizedKey, fact.value, {
          source: 'extractor',
          confidence,
        });
        console.log(
          `[MemoryExtractor] Saved: ${normalizedKey} = ${fact.value}` +
          (normalizedKey !== fact.key ? ` (normalized from "${fact.key}")` : '')
        );
      }
      recordMemoryExtract(true);
    } catch (error) {
      recordMemoryExtract(false);
      console.error('[MemoryExtractor] Error extracting facts:', error);
    }
  }

  private getConfidenceThreshold(): number {
    const parsed = Number(process.env.ENZO_MEMORY_CONFIDENCE_THRESHOLD ?? 0.55);
    if (!Number.isFinite(parsed)) return 0.55;
    return Math.min(0.95, Math.max(0, parsed));
  }

  /**
   * Ranked profile memories for this turn (lexical top‑k when ENZO_MEMORY_RECALL_TOP_K > 0).
   */
  async getRankedMemoriesForTurn(userId: string, queryHint?: string): Promise<Memory[]> {
    return this.memoryService.recallRankedForPrompt(userId, queryHint, { recordMetrics: true });
  }

  /** Formats ranked memories into the injected profile block (no sanitization — Orchestrator sanitizes assistant name clashes). */
  formatMemoryFactsBlock(memories: Memory[]): string {
    if (!memories?.length) {
      return '';
    }
    // Build sentence-form lines so "name: Franco" cannot be misread as the assistant's name
    const lines: string[] = [];
    for (const m of memories) {
      const key = (m.key ?? '').toLowerCase().trim();
      const val = (m.value ?? '').trim();
      if (!val) continue;
      if (key === 'name') {
        lines.push(`The user's name is "${val}".`);
      } else if (key === 'city') {
        lines.push(`The user lives in ${val}.`);
      } else if (key === 'profession') {
        lines.push(`The user's profession: ${val}.`);
      } else if (key === 'family') {
        lines.push(`User family info: ${val}.`);
      } else if (key === 'preferences') {
        lines.push(`User preferences: ${val}.`);
      } else if (key === 'routines') {
        lines.push(`User routines: ${val}.`);
      } else if (key === 'projects') {
        lines.push(`User projects: ${val}.`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    }
    if (lines.length === 0) return '';
    const body = lines.join('\n');
    return `FACTS ABOUT THE USER (the person chatting with you — NOT the assistant):
${body}
When the user asks "what is my name?" or "who am I?", answer using the name above.
These facts are about the USER only — never apply them to the assistant's identity.`;
  }

  /**
   * Carga memorias rankeadas vs el mensaje actual y las formatea para el system prompt.
   */
  async buildMemoryBlock(userId: string, queryHint?: string): Promise<string> {
    try {
      const memories = await this.getRankedMemoriesForTurn(userId, queryHint);
      return this.formatMemoryFactsBlock(memories);
    } catch (error) {
      console.error('[MemoryExtractor] Error building memory block:', error);
      return '';
    }
  }

  /** Single pass: ranked slice + formatted block + raw rows for Amplifier delegation. */
  async buildRankedMemoryBlock(userId: string, queryHint?: string): Promise<{ block: string; facts: Memory[] }> {
    const facts = await this.getRankedMemoriesForTurn(userId, queryHint);
    return {
      facts,
      block: this.formatMemoryFactsBlock(facts),
    };
  }

  /**
   * Usa el modelo para extraer hechos relevantes de la conversación.
   */
  private async extract(
    userMessage: string,
    assistantResponse: string
  ): Promise<ExtractedFact[]> {
    const systemPrompt = `Extract facts about the user from this conversation.
Respond ONLY with JSON: {"facts": [{"key": "...", "value": "...", "confidence": 0.0-1.0}]}

ALLOWED KEYS — return ONLY these exact strings as "key", never Spanish variants, synonyms, or any other string:
name, city, profession, projects, preferences, routines, family, other

Rules:
- Use only the allowed keys above (e.g. "profession" not "ocupacion", "city" not "ciudad")
- If unsure which key fits, use "other"
- For key "projects": put the project title on the very first line of "value", followed by details or stack on following lines (helps downstream display)
- Include "confidence" per fact (how sure it is grounded in the user's words)
- Only extract concrete, durable facts
- If nothing to extract, return {"facts": []}
- Extract facts ONLY from what the USER said
- Never extract assistant identity, assistant preferences, or assistant claims
- Never extract temporary or task-specific information, file paths, or search queries`;

    const conversation = `User: ${userMessage}\nAssistant: ${assistantResponse}`;

    const response = await this.provider.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: conversation },
      ],
      temperature: 0.1,
      maxTokens: 512,
    });

    const content = response.content?.trim() ?? '';

    const parsed = parseFirstJsonObject<{ facts?: ExtractedFact[] }>(content, { tryRepair: true });
    if (!parsed) {
      return [];
    }

    if (!parsed.value.facts || !Array.isArray(parsed.value.facts)) {
      return [];
    }

    const assistantResponseLower = assistantResponse.toLowerCase();

    // Filtrar facts vacíos o inválidos
    return parsed.value.facts
      .filter(
        (f: any) => f.key && f.value &&
          typeof f.key === 'string' &&
          typeof f.value === 'string' &&
          f.key.trim().length > 0 &&
          f.value.trim().length > 0
      )
      .filter((f: any) => {
        const key = String(f.key).toLowerCase().trim();
        const value = String(f.value).trim();
        const sensitivePattern = /(api[_ -]?key|token|password|secret|system prompt|private key|ssh key|credential)/i;
        if (sensitivePattern.test(key) || sensitivePattern.test(value)) {
          return false;
        }
        // Prevent poisoning user profile with assistant self-identification
        if (key === 'name' && value.length > 0) {
          const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const assistantSelfNameRegex = new RegExp(`\\b(my name is|mi nombre es)\\s+${escapedValue}\\b`, 'i');
          if (assistantSelfNameRegex.test(assistantResponseLower)) {
            return false;
          }
        }
        return true;
      })
      .map((f: any) => ({
        key: String(f.key).trim(),
        value: String(f.value).trim(),
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.7,
      }));
  }
}
