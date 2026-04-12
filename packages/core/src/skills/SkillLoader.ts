import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SkillStep {
  id: string;
  description: string;
  tool?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  enabled?: boolean;
  steps?: SkillStep[];
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

    const body = lines.slice(frontmatterEnd + 1).join('\n').trim();

    return { metadata, body };
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
      timeZone: process.env.TZ || 'America/Santiago'
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
