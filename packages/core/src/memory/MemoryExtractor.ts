import { LLMProvider } from '../providers/types.js';
import { MemoryService } from './MemoryService.js';
import { normalizeMemoryKey } from './MemoryKeys.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';

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
        await this.memoryService.remember(userId, normalizedKey, fact.value);
        console.log(
          `[MemoryExtractor] Saved: ${normalizedKey} = ${fact.value}` +
          (normalizedKey !== fact.key ? ` (normalized from "${fact.key}")` : '')
        );
      }
    } catch (error) {
      console.error('[MemoryExtractor] Error extracting facts:', error);
    }
  }

  private getConfidenceThreshold(): number {
    const parsed = Number(process.env.ENZO_MEMORY_CONFIDENCE_THRESHOLD ?? 0.55);
    if (!Number.isFinite(parsed)) return 0.55;
    return Math.min(0.95, Math.max(0, parsed));
  }

  /**
   * Carga las memorias del usuario y las formatea como bloque
   * para inyectar en el system prompt.
   */
  async buildMemoryBlock(userId: string): Promise<string> {
    try {
      const memories = await this.memoryService.recall(userId);

      if (!memories || memories.length === 0) {
        return '';
      }

      const facts = memories
        .map(m => `${m.key}: ${m.value}`)
        .join(', ');

      return `[IMPORTANT - USER PROFILE: ${facts}]
The user asking you questions has this profile above.
Use this ONLY for facts about the user (their name, city, profession, etc.).
If the user asks about THEMSELVES (e.g. "what is my name?"), answer from this profile.
If the user asks about YOU (assistant), DO NOT use this profile; use assistant identity instructions instead.
Never treat user profile fields as assistant identity.
Always answer as if YOU know the user personally.`;
    } catch (error) {
      console.error('[MemoryExtractor] Error building memory block:', error);
      return '';
    }
  }

  /**
   * Usa el modelo para extraer hechos relevantes de la conversación.
   */
  private async extract(
    userMessage: string,
    assistantResponse: string
  ): Promise<ExtractedFact[]> {
    const systemPrompt = `Extract facts about the user from this conversation.
Respond ONLY with JSON: {"facts": [{"key": "...", "value": "..."}]}

ALLOWED KEYS (use exactly these, nothing else):
name, city, profession, projects, preferences, routines, family, other

Rules:
- Use only the allowed keys above
- If unsure which key fits, use "other"
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
