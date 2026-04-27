import fs from 'fs';
import { SkillLoader, LoadedSkill } from './SkillLoader.js';
import { MemoryService } from '../memory/MemoryService.js';

export class SkillRegistry {
  private skills: Map<string, LoadedSkill> = new Map();
  private loader: SkillLoader;
  private memoryService: MemoryService;
  private skillsWatcher: fs.FSWatcher | null = null;
  private watchDebounceTimer: NodeJS.Timeout | null = null;

  constructor(skillsDir?: string, memoryService?: MemoryService) {
    this.loader = new SkillLoader(skillsDir);
    this.memoryService = memoryService || new MemoryService();
  }

  register(skill: LoadedSkill): void {
    // Get enabled status from memory if it exists
    const config = this.memoryService.getSkillConfig(skill.id);
    const enabled = config ? config.enabled : skill.enabled;

    this.skills.set(skill.id, {
      ...skill,
      enabled,
    });

    console.log(`[SkillRegistry] Registered skill: ${skill.id} (enabled: ${enabled})`);
  }

  get(id: string): LoadedSkill | null {
    return this.skills.get(id) || null;
  }

  getAll(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  getEnabled(): LoadedSkill[] {
    return Array.from(this.skills.values()).filter(s => s.enabled);
  }

  enable(id: string): void {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = true;
      this.memoryService.saveSkillConfig(id, true);
      console.log(`[SkillRegistry] Enabled skill: ${id}`);
    }
  }

  disable(id: string): void {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = false;
      this.memoryService.saveSkillConfig(id, false);
      console.log(`[SkillRegistry] Disabled skill: ${id}`);
    }
  }

  async reload(): Promise<void> {
    console.log('[SkillRegistry] Reloading skills from filesystem...');
    this.skills.clear();

    const loadedSkills = await this.loader.scanSkills();
    for (const skill of loadedSkills) {
      this.register(skill);
    }

    console.log(`[SkillRegistry] Reloaded ${loadedSkills.length} skills`);
  }

  startWatching(): void {
    const skillsDir = this.loader.getSkillsDir();

    if (!fs.existsSync(skillsDir)) {
      return;
    }

    this.stopWatching();

    this.skillsWatcher = fs.watch(skillsDir, { recursive: true }, (_eventType, filename) => {
      if (!filename?.endsWith('SKILL.md')) {
        return;
      }

      if (this.watchDebounceTimer) {
        clearTimeout(this.watchDebounceTimer);
      }
      this.watchDebounceTimer = setTimeout(() => {
        this.watchDebounceTimer = null;
        void (async () => {
          try {
            await this.reload();
            console.log(`[SkillRegistry] Hot reload triggered by: ${filename}`);
          } catch (err) {
            console.error('[SkillRegistry] Hot reload failed:', err);
          }
        })();
      }, 500);
    });
  }

  stopWatching(): void {
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    if (this.skillsWatcher) {
      this.skillsWatcher.close();
      this.skillsWatcher = null;
    }
  }
}
