import type { LLMProvider } from '../providers/types.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { LoadedSkill, SkillStep } from '../skills/SkillLoader.js';
import { foldDiacritics } from '../utils/foldDiacritics.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';

export interface RelevantSkill {
  id: string
  name: string
  description: string
  content: string
  relevanceScore: number
  steps?: SkillStep[]
}

export type SkillResolveOptions = {
  /** When ENZO_SKILLS_LLM_SELECTION is true (default), used together with withTimeout for semantic reordering after heuristic scores. Set to false for heuristic-only selection. */
  llm?: LLMProvider;
  withTimeout?: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
};

/** Merge parent message resolution with subtask resolution (max score wins per id), capped. */
export function mergeResolvedSkills(
  parentSkills: RelevantSkill[],
  subtaskSkills: RelevantSkill[],
  maxSkills: number
): RelevantSkill[] {
  const cap = Math.max(1, Math.floor(maxSkills));
  const map = new Map<string, RelevantSkill>();
  for (const s of parentSkills) {
    map.set(s.id, { ...s });
  }
  for (const s of subtaskSkills) {
    const prev = map.get(s.id);
    if (!prev || s.relevanceScore >= prev.relevanceScore) {
      map.set(s.id, { ...s });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, cap);
}

export function resolveMaxSkillsInjection(): number {
  const fromEnv = Number(process.env.ENZO_SKILLS_MAX_INJECTION ?? 3);
  if (Number.isNaN(fromEnv)) return 3;
  return Math.max(1, Math.floor(fromEnv));
}

export class SkillResolver {
  async resolveRelevantSkills(
    message: string,
    skillRegistry: SkillRegistry | undefined,
    options?: SkillResolveOptions
  ): Promise<RelevantSkill[]> {
    if (!skillRegistry) return []

    const enabledSkills = skillRegistry.getEnabled()
    const skillPool = enabledSkills.length > 0
      ? enabledSkills
      : (this.shouldFallbackWhenNoneEnabled() ? skillRegistry.getAll() : [])
    if (skillPool.length === 0) return []

    if (enabledSkills.length === 0 && process.env.ENZO_DEBUG === 'true') {
      console.log('[SkillResolver] No enabled skills. Using fallback over all loaded skills.')
    }

    const relevant: RelevantSkill[] = []
    const scored: RelevantSkill[] = []
    const threshold = this.resolveThreshold()
    const maxSkills = this.resolveMaxSkills()

    for (const skill of skillPool) {
      const score = this.calculateRelevance(message, skill)

      if (process.env.ENZO_DEBUG === 'true') {
        console.log(`[SkillResolver] "${skill.metadata.name}": ${(score * 100).toFixed(0)}%`)
      }

      const candidate: RelevantSkill = {
        id: skill.id,
        name: skill.metadata.name,
        description: skill.metadata.description,
        content: skill.content,
        relevanceScore: score,
        steps: skill.metadata.steps,
      }

      scored.push(candidate)
      if (score >= threshold) relevant.push(candidate)
    }

    let heuristicResult: RelevantSkill[]
    if (relevant.length > 0) {
      heuristicResult = relevant
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxSkills)
    } else {
      const fallbackThreshold = this.resolveFallbackThreshold()
      const fallbackMax = this.resolveFallbackMaxSkills(maxSkills)
      heuristicResult = scored
        .filter((skill) => skill.relevanceScore >= fallbackThreshold)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, fallbackMax)
    }

    const semantic = await this.trySemanticReordering(message, scored, maxSkills, options)
    if (semantic && semantic.length > 0) {
      if (process.env.ENZO_DEBUG === 'true') {
        console.log('[SkillResolver] Applied ENZO_SKILLS_LLM_SELECTION ranking:', semantic.map((s) => s.id).join(', '))
      }
      return semantic
    }

    return heuristicResult
  }

  private semanticSelectionEnabled(): boolean {
    return (process.env.ENZO_SKILLS_LLM_SELECTION ?? 'true').toLowerCase() === 'true'
  }

  private semanticMinHeuristic(): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_SEMANTIC_MIN_HEURISTIC ?? 0.08)
    if (Number.isNaN(fromEnv)) return 0.08
    return Math.min(Math.max(fromEnv, 0), 1)
  }

  private async trySemanticReordering(
    message: string,
    scored: RelevantSkill[],
    maxSkills: number,
    options?: SkillResolveOptions
  ): Promise<RelevantSkill[] | null> {
    if (!this.semanticSelectionEnabled() || !options?.llm || !options.withTimeout || scored.length === 0) {
      return null
    }

    const catalog = scored.map((s) => ({
      id: s.id,
      name: s.name,
      description: (s.description ?? '').slice(0, 500),
    }))

    const system = `You route user tasks to assistant skills. Given the user message and a skill catalog, respond with ONE JSON object only:
{"skillIds":["id1","id2"]}
Rules:
- Include at most ${maxSkills} ids, most relevant first.
- Use only ids that appear in the catalog.
- If no skill fits, use {"skillIds":[]}.
- Do not wrap in markdown. No other keys.`

    const userPayload = [
      'USER MESSAGE:',
      message.slice(0, 4000),
      '',
      'CATALOG:',
      JSON.stringify(catalog),
    ].join('\n')

    try {
      const resp = await options.withTimeout(
        options.llm.complete({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPayload },
          ],
          temperature: 0,
          maxTokens: 256,
        }),
        60_000,
        'skill-semantic-rank'
      )

      const raw = resp.content ?? ''
      const parsed = parseFirstJsonObject<{ skillIds?: unknown }>(raw, { tryRepair: true })
      if (!parsed?.value || !Array.isArray(parsed.value.skillIds)) {
        return null
      }

      const ids = parsed.value.skillIds.filter((x): x is string => typeof x === 'string')
      const byId = new Map(scored.map((s) => [s.id, s]))
      const minHeuristic = this.semanticMinHeuristic()
      const picked: RelevantSkill[] = []
      const used = new Set<string>()

      for (const id of ids) {
        const s = byId.get(id)
        if (s && !used.has(id) && s.relevanceScore >= minHeuristic) {
          used.add(id)
          picked.push({ ...s, relevanceScore: Math.max(s.relevanceScore, 0.97) })
        }
        if (picked.length >= maxSkills) break
      }

      if (picked.length === 0) {
        return null
      }

      const rest = [...scored]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .filter((s) => !used.has(s.id))
      for (const s of rest) {
        if (picked.length >= maxSkills) break
        picked.push(s)
      }

      return picked
    } catch (err) {
      if (process.env.ENZO_DEBUG === 'true') {
        console.warn('[SkillResolver] Semantic ranking failed:', err)
      }
      return null
    }
  }

  private shouldFallbackWhenNoneEnabled(): boolean {
    const fromEnv = (process.env.ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED ?? 'true').toLowerCase()
    return fromEnv !== 'false'
  }

  private resolveThreshold(): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_RELEVANCE_THRESHOLD ?? 0.3)
    if (Number.isNaN(fromEnv)) return 0.3
    return Math.min(Math.max(fromEnv, 0), 1)
  }

  private resolveMaxSkills(): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_MAX_INJECTION ?? 3)
    if (Number.isNaN(fromEnv)) return 3
    return Math.max(1, Math.floor(fromEnv))
  }

  private resolveFallbackThreshold(): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_FALLBACK_RELEVANCE_THRESHOLD ?? 0.12)
    if (Number.isNaN(fromEnv)) return 0.12
    return Math.min(Math.max(fromEnv, 0), 1)
  }

  private resolveFallbackMaxSkills(maxSkills: number): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_FALLBACK_MAX_INJECTION ?? 1)
    if (Number.isNaN(fromEnv)) return 1
    return Math.min(maxSkills, Math.max(1, Math.floor(fromEnv)))
  }

  private calculateRelevance(message: string, skill: LoadedSkill): number {
    const haystack = foldDiacritics(message.toLowerCase())
    const triggers = skill.metadata.triggers
    if (triggers?.length) {
      for (const trigger of triggers) {
        if (!trigger) continue
        const needle = foldDiacritics(trigger.toLowerCase()).trim()
        if (needle.length === 0) continue
        if (haystack.includes(needle)) return 1.0
      }
    }

    const normalizedMessage = this.normalizeText(message)
    const normalizedName = this.normalizeText(skill.metadata.name)
    const normalizedDescription = this.normalizeText(skill.metadata.description)
    const normalizedContent = this.normalizeText(skill.content)

    // 1) Exact / near-exact skill name match should dominate.
    if (normalizedMessage.includes(normalizedName)) return 1.0

    const messageTokens = this.extractTokens(normalizedMessage)
    const nameTokens = this.extractTokens(normalizedName)
    const descriptionTokens = this.extractTokens(normalizedDescription)
    const contentTokens = this.extractTokens(normalizedContent).slice(0, 120)

    const nameOverlap = this.computeTokenOverlap(messageTokens, nameTokens)
    const descriptionOverlap = this.computeTokenOverlap(messageTokens, descriptionTokens)
    const contentOverlap = this.computeTokenOverlap(messageTokens, contentTokens)
    const exampleOverlap = this.matchExamples(normalizedMessage, normalizedContent)

    // Weighted scoring, tuned to prefer name+description intent,
    // while allowing examples/content to rescue partial phrasings.
    const score =
      (nameOverlap * 0.45) +
      (descriptionOverlap * 0.30) +
      (exampleOverlap * 0.20) +
      (contentOverlap * 0.05)

    return Math.min(Math.max(score, 0), 1)
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  }

  private extractTokens(text: string): string[] {
    const stopwords = new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
      'de', 'del', 'al', 'en', 'con', 'por', 'para', 'que',
      'cuando', 'como', 'este', 'esta', 'estos', 'estas',
      'solo', 'usar', 'me', 'se', 'si', 'no', 'o',
      'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to',
      'use', 'only', 'when', 'with', 'from', 'this', 'that',
      'your', 'you', 'are', 'how', 'what', 'why',
    ])

    return text
      .split(/[^a-z0-9_]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopwords.has(token))
  }

  private computeTokenOverlap(source: string[], target: string[]): number {
    if (source.length === 0 || target.length === 0) return 0
    const sourceSet = new Set(source)
    const targetSet = new Set(target)
    let matches = 0
    for (const token of targetSet) {
      if (sourceSet.has(token)) matches++
    }
    return matches / targetSet.size
  }

  private matchExamples(message: string, skillContent: string): number {
    // Extraer líneas de ejemplos del SKILL.md (líneas que empiezan con - o •)
    const exampleLines = skillContent
      .split('\n')
      .filter(line => /^[-•*]\s+/.test(line.trim()))
      .map(line => this.normalizeText(line.replace(/^[-•*]\s+/, '').trim()))

    if (exampleLines.length === 0) return 0

    // Para cada ejemplo, calcular qué tan similar es al mensaje
    let bestMatch = 0

    for (const example of exampleLines) {
      const exampleWords = this.extractTokens(example)
      const messageWords = this.extractTokens(message)
      const similarity = this.computeTokenOverlap(messageWords, exampleWords)

      if (similarity > bestMatch) bestMatch = similarity
    }

    return bestMatch
  }
}