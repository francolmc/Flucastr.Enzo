import type { LLMProvider } from '../providers/types.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { LoadedSkill } from '../skills/SkillLoader.js';
import { foldDiacritics } from '../utils/foldDiacritics.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';

export interface RelevantSkill {
  id: string
  name: string
  description: string
  content: string
  relevanceScore: number
}

export type SkillResolveOptions = {
  /** When ENZO_SKILLS_LLM_SELECTION is true (default), used together with withTimeout for LLM-based skill selection. Set to false for heuristic-only selection. */
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

    const maxSkills = this.resolveMaxSkills()

    const scored: RelevantSkill[] = []
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
      }

      scored.push(candidate)
    }

    const preFilterLimit = this.resolvePreFilterLimit()
    const preFiltered = scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, preFilterLimit)

    if (process.env.ENZO_DEBUG === 'true') {
      console.log('[SkillResolver] Pre-filtered skills:', preFiltered.map(s => s.id).join(', '))
    }

    const llmSelected = await this.selectSkillsByLLM(message, preFiltered, maxSkills, options)
    if (llmSelected && llmSelected.length > 0) {
      if (process.env.ENZO_DEBUG === 'true') {
        console.log('[SkillResolver] LLM selected skills:', llmSelected.map((s) => s.id).join(', '))
      }
      return llmSelected
    }

    const fallbackResult = scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxSkills)

    if (process.env.ENZO_DEBUG === 'true') {
      console.log('[SkillResolver] Using heuristic fallback:', fallbackResult.map((s) => s.id).join(', '))
    }

    return fallbackResult
  }

  private resolvePreFilterLimit(): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_LLM_PRE_FILTER ?? 5)
    if (Number.isNaN(fromEnv)) return 5
    return Math.max(1, Math.min(fromEnv, 20))
  }

  private fewShotEnabled(): boolean {
    return (process.env.ENZO_SKILLS_FEW_SHOT_ENABLED ?? 'true').toLowerCase() !== 'false'
  }

  private semanticSelectionEnabled(): boolean {
    return (process.env.ENZO_SKILLS_LLM_SELECTION ?? 'true').toLowerCase() === 'true'
  }

  private extractExampleFromSkill(skillContent: string): string | null {
    const lines = skillContent.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (/^[-•*]\s+./.test(trimmed)) {
        const example = trimmed.replace(/^[-•*]\s+/, '').trim()
        if (example.length > 0) {
          return example
        }
      }
    }
    return null
  }

  private generateSyntheticExample(name: string, description: string): string {
    const normalizedName = name.toLowerCase().trim()
    const normalizedDesc = description.toLowerCase()

    const templates: Record<string, string[]> = {
      weather: ['dime el clima en [ciudad]', 'qué tiempo hace en [ciudad]'],
      datetime: ['qué hora es', 'qué día es hoy'],
      capture: ['anota esta idea', 'quiero capturar una idea'],
      'enzo-notes': ['toma nota de', 'escribe esto en notas'],
      'focus-advisor': ['ayúdame a concentrarme', 'cómo puedo ser más productivo'],
      'morning-briefing': ['dame el briefing matutino', 'resumen de la mañana'],
      'project-context': ['qué es este proyecto', 'dame contexto del proyecto'],
      'github-cli-enzo': ['busca en github', 'muéstrame los commits'],
    }

    if (templates[normalizedName]) {
      return templates[normalizedName][0]
    }

    if (normalizedDesc.includes('clima') || normalizedDesc.includes('tiempo') || normalizedDesc.includes('temperatura')) {
      return 'dime el clima en [ciudad]'
    }
    if (normalizedDesc.includes('fecha') || normalizedDesc.includes('hora')) {
      return 'qué hora es'
    }
    if (normalizedDesc.includes('nota') || normalizedDesc.includes('idea') || normalizedDesc.includes('capturar')) {
      return 'anota esta idea'
    }
    if (normalizedDesc.includes('focus') || normalizedDesc.includes('concentr')) {
      return 'ayúdame a concentrarme'
    }
    if (normalizedDesc.includes('briefing') || normalizedDesc.includes('mañana')) {
      return 'dame el briefing matutino'
    }
    if (normalizedDesc.includes('proyecto') || normalizedDesc.includes('contexto')) {
      return 'qué es este proyecto'
    }
    if (normalizedDesc.includes('github')) {
      return 'busca en github'
    }

    return `quiero usar ${normalizedName}`
  }

  private buildFewShotExamples(skills: { id: string; name: string; description: string; content: string }[]): string {
    const examples: string[] = []

    for (const skill of skills) {
      let example = this.extractExampleFromSkill(skill.content)
      if (!example) {
        example = this.generateSyntheticExample(skill.name, skill.description)
      }
      if (example) {
        examples.push(`- "${example}" -> {"skillIds": ["${skill.id}"]}`)
      }
    }

    if (examples.length === 0) {
      return ''
    }

    return '\nFEW-SHOT EXAMPLES:\n' + examples.slice(0, 5).join('\n')
  }

  private async selectSkillsByLLM(
    message: string,
    preFiltered: RelevantSkill[],
    maxSkills: number,
    options?: SkillResolveOptions
  ): Promise<RelevantSkill[] | null> {
    if (!this.semanticSelectionEnabled() || !options?.llm || !options.withTimeout || preFiltered.length === 0) {
      return null
    }

    const catalog = preFiltered.map((s) => ({
      id: s.id,
      name: s.name,
      description: (s.description ?? '').slice(0, 500),
      content: s.content,
    }))

    let fewShotSection = ''
    if (this.fewShotEnabled()) {
      fewShotSection = this.buildFewShotExamples(catalog)
    }

    const systemBase = `Eres un sistema de enrutamiento de habilidades. Dado el mensaje del usuario y un catálogo de skills, selecciona la(s) skill(s) más relevante(s) basándote en la descripción de cada skill.`

    const systemRules = `
Responde con UN SOLO objeto JSON:
{"skillIds":["id1","id2"]}
Reglas:
- Incluye hasta ${maxSkills} ids, más relevantes primero.
- Usa solo ids del catálogo.
- Si ninguna skill es relevante, usa {"skillIds":[]}.
- No uses markdown. Solo el objeto JSON.`

    const system = systemBase + systemRules + fewShotSection

    const catalogJson = catalog
      .map((c) => `- ${c.id}: ${c.name} - ${c.description}`)
      .join('\n')

    const userPayload = [
      'MENSAJE DEL USUARIO:',
      message.slice(0, 4000),
      '',
      'CATÁLOGO DE SKILLS:',
      catalogJson,
    ].join('\n')

    try {
      const resp = await options.withTimeout(
        options.llm.complete({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPayload },
          ],
          temperature: 0.3,
          maxTokens: 256,
        }),
        60_000,
        'skill-llm-selection'
      )

      const raw = resp.content ?? ''
      const parsed = parseFirstJsonObject<{ skillIds?: unknown }>(raw, { tryRepair: true })

      if (!parsed?.value || !Array.isArray(parsed.value.skillIds)) {
        if (process.env.ENZO_DEBUG === 'true') {
          console.warn('[SkillResolver] LLM selection failed: invalid JSON response')
        }
        return null
      }

      const ids = parsed.value.skillIds.filter((x): x is string => typeof x === 'string')
      const byId = new Map(preFiltered.map((s) => [s.id, s]))

      const picked: RelevantSkill[] = []
      const used = new Set<string>()

      for (const id of ids) {
        const s = byId.get(id)
        if (s && !used.has(id)) {
          used.add(id)
          picked.push({ ...s, relevanceScore: 1.0 })
        }
        if (picked.length >= maxSkills) break
      }

      if (picked.length === 0) {
        if (process.env.ENZO_DEBUG === 'true') {
          console.log('[SkillResolver] LLM returned no valid skill ids, using fallback')
        }
        return null
      }

      return picked
    } catch (err) {
      if (process.env.ENZO_DEBUG === 'true') {
        console.warn('[SkillResolver] LLM selection failed:', err)
      }
      return null
    }
  }

  private shouldFallbackWhenNoneEnabled(): boolean {
    const fromEnv = (process.env.ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED ?? 'true').toLowerCase()
    return fromEnv !== 'false'
  }

  private resolveMaxSkills(): number {
    const fromEnv = Number(process.env.ENZO_SKILLS_MAX_INJECTION ?? 3)
    if (Number.isNaN(fromEnv)) return 3
    return Math.max(1, Math.floor(fromEnv))
  }

  private calculateRelevance(message: string, skill: LoadedSkill): number {
    const normalizedMessage = this.normalizeText(message)
    const normalizedName = this.normalizeText(skill.metadata.name)
    const normalizedDescription = this.normalizeText(skill.metadata.description)
    const normalizedContent = this.normalizeText(skill.content)

    if (normalizedMessage.includes(normalizedName)) return 1.0

    const messageTokens = this.extractTokens(normalizedMessage)
    const nameTokens = this.extractTokens(normalizedName)
    const descriptionTokens = this.extractTokens(normalizedDescription)
    const contentTokens = this.extractTokens(normalizedContent).slice(0, 120)

    const nameOverlap = this.computeTokenOverlap(messageTokens, nameTokens)
    const descriptionOverlap = this.computeTokenOverlap(messageTokens, descriptionTokens)
    const contentOverlap = this.computeTokenOverlap(messageTokens, contentTokens)
    const exampleOverlap = this.matchExamples(normalizedMessage, normalizedContent)

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
    const exampleLines = skillContent
      .split('\n')
      .filter(line => /^[-•*]\s+/.test(line.trim()))
      .map(line => this.normalizeText(line.replace(/^[-•*]\s+/, '').trim()))

    if (exampleLines.length === 0) return 0

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