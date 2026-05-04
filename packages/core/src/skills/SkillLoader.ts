import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { homedir } from 'os';
import { resolvePreferredWallClockTimeZoneId } from '../orchestrator/runtimeHostContext.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SkillStep {
  id: string;
  description: string;
  /** Registered Enzo/MCP tool name for a single-step fast-path lock (see orchestrator SKILL_FASTPATH_LOCKED). */
  tool?: string;
  /** Hint for prompts when `tool` is `execute_command` (YAML may use camelCase or `command_hint`). */
  commandHint?: string;
  command_hint?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  enabled?: boolean;
  // AgentSkills.io standard fields
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
}

/** Minimal skill info for discovery phase (progressive disclosure) */
export interface SkillDiscovery {
  id: string;
  name: string;
  description: string;
  path: string;
  hasBody: boolean;
}

export interface LoadedSkill {
  id: string;
  metadata: SkillMetadata;
  content: string;
  path: string;
  enabled: boolean;
}

export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir?: string) {
    if (skillsDir) {
      this.skillsDir = skillsDir.replace('~', homedir());
    } else {
      const envPath = process.env.ENZO_SKILLS_PATH;
      this.skillsDir = envPath 
        ? envPath.replace('~', homedir())
        : path.join(homedir(), '.enzo', 'skills');
    }

    this.ensureSkillsDirectory();
  }

  getSkillsDir(): string {
    return this.skillsDir;
  }

  private ensureSkillsDirectory(): void {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
      console.log(`[SkillLoader] Created skills directory: ${this.skillsDir}`);
    }
  }

  async scanSkills(): Promise<LoadedSkill[]> {
    const skills: LoadedSkill[] = [];

    if (!fs.existsSync(this.skillsDir)) {
      console.log(`[SkillLoader] Skills directory not found: ${this.skillsDir}`);
      return skills;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillId = entry.name;
      const skillPath = path.join(this.skillsDir, skillId);
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) {
        console.warn(`[SkillLoader] SKILL.md not found in ${skillPath}`);
        continue;
      }

      try {
        const skill = await this.loadSkill(skillId);
        if (skill) {
          skills.push(skill);
        }
      } catch (error) {
        console.error(`[SkillLoader] Error loading skill ${skillId}:`, error);
      }
    }

    return skills;
  }

  /** Throws if frontmatter or required fields are invalid (for API validation before write). */
  validateRawMarkdown(raw: string): void {
    this.parseFrontmatter(raw);
  }

  /**
   * Load only metadata for discovery phase (progressive disclosure).
   * Fast operation that doesn't read/process the full body content.
   */
  async loadSkillMetadata(id: string): Promise<{ metadata: SkillMetadata; path: string; hasBody: boolean } | null> {
    const skillPath = path.join(this.skillsDir, id);
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      console.warn(`[SkillLoader] SKILL.md not found for skill: ${id}`);
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { metadata, body, hasBody } = this.parseFrontmatterWithBodyInfo(content);
      return { metadata, path: skillPath, hasBody };
    } catch (error) {
      console.error(`[SkillLoader] Error loading skill metadata ${id}:`, error);
      return null;
    }
  }

  async loadSkill(id: string): Promise<LoadedSkill | null> {
    const skillPath = path.join(this.skillsDir, id);
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      console.warn(`[SkillLoader] SKILL.md not found for skill: ${id}`);
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { metadata, body } = this.parseFrontmatter(content);

      // Resolve dynamic placeholders in the body
      const processedBody = this.resolvePlaceholders(body);

      return {
        id,
        metadata,
        content: processedBody,
        path: skillPath,
        enabled: this.resolveDefaultEnabled(metadata),
      };
    } catch (error) {
      console.error(`[SkillLoader] Error loading skill ${id}:`, error);
      return null;
    }
  }

  /**
   * Parse frontmatter and return metadata plus body info.
   * Includes validation for AgentSkills.io standard fields.
   */
  private parseFrontmatterWithBodyInfo(content: string): { metadata: SkillMetadata; body: string; hasBody: boolean } {
    const result = this.parseFrontmatter(content);
    const hasBody = result.body.trim().length > 0;
    return { ...result, hasBody };
  }

  private parseFrontmatter(content: string): { metadata: SkillMetadata; body: string } {
    const lines = content.split('\n');
    let frontmatterEnd = -1;
    let frontmatterStart = -1;

    // Find the first --- (start of frontmatter)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        frontmatterStart = i;
        break;
      }
    }

    // Find the second --- (end of frontmatter)
    if (frontmatterStart !== -1) {
      for (let i = frontmatterStart + 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
          frontmatterEnd = i;
          break;
        }
      }
    }

    if (frontmatterStart === -1 || frontmatterEnd === -1) {
      throw new Error('Invalid SKILL.md format: missing frontmatter delimiters');
    }

    const frontmatterLines = lines.slice(frontmatterStart + 1, frontmatterEnd);
    const frontmatterContent = frontmatterLines.join('\n');
    const metadata = yaml.load(frontmatterContent) as SkillMetadata;

    if (!metadata.name || !metadata.description) {
      throw new Error('Invalid SKILL.md: missing required fields (name, description)');
    }

    // AgentSkills.io validation: name must match folder naming conventions
    if (!this.isValidAgentSkillName(metadata.name)) {
      console.warn(`[SkillLoader] Warning: skill name "${metadata.name}" doesn't follow AgentSkills.io conventions (lowercase a-z, hyphens only)`);
    }

    const body = lines.slice(frontmatterEnd + 1).join('\n').trim();

    return { metadata, body };
  }

  /**
   * Validate skill name according to AgentSkills.io standard:
   * - 1-64 characters
   * - Only lowercase a-z and hyphens
   * - No leading/trailing hyphens
   * - No consecutive hyphens
   */
  private isValidAgentSkillName(name: string): boolean {
    if (!name || name.length < 1 || name.length > 64) return false;
    if (!/^[a-z0-9-]+$/.test(name)) return false;
    if (name.startsWith('-') || name.endsWith('-')) return false;
    if (name.includes('--')) return false;
    return true;
  }

  /**
   * Check if skill name matches the folder name (AgentSkills.io requirement).
   * Returns a warning message if they don't match, null if OK.
   */
  validateNameMatchesFolder(skillId: string, metadataName: string): string | null {
    if (skillId !== metadataName) {
      return `Skill name "${metadataName}" doesn't match folder name "${skillId}" (AgentSkills.io recommends they match)`;
    }
    return null;
  }

  private resolveDefaultEnabled(metadata: SkillMetadata): boolean {
    if (typeof metadata.enabled === 'boolean') {
      return metadata.enabled;
    }

    const envDefault = (process.env.ENZO_SKILLS_DEFAULT_ENABLED || 'false').toLowerCase();
    return envDefault === 'true';
  }

  private resolvePlaceholders(content: string): string {
    const now = new Date();
    
    // Timezone-aware datetime formatting in Spanish
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: resolvePreferredWallClockTimeZoneId(process.env.TZ || 'America/Santiago')
    };
    
    const fullDatetime = now.toLocaleDateString('es-CL', options);
    const dateOnly = now.toLocaleDateString('es-CL');
    const timeOnly = now.toLocaleTimeString('es-CL');
    
    return content
      .replace(/\{\{CURRENT_DATETIME\}\}/g, fullDatetime)
      .replace(/\{\{CURRENT_DATE\}\}/g, dateOnly)
      .replace(/\{\{CURRENT_TIME\}\}/g, timeOnly);
  }
}
