import { v4 as uuidv4 } from 'uuid';

export interface Lesson {
  id: string;
  userId: string;
  taskPattern: string;
  complexity: string;
  successfulStrategy: {
    classification: string;
    skillsUsed: string[];
    mcpsUsed: string[];
    decompositionSteps?: string[];
    toolsUsed?: string[];
  };
  failedAttempts?: Array<{
    reason: string;
    whatWentWrong: string;
  }>;
  successCount: number;
  failureCount: number;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface LessonSummary {
  id: string;
  taskPattern: string;
  successCount: number;
  failureCount: number;
  lastUsedAt: string;
}

export interface LessonDetails extends LessonSummary {
  successfulStrategy: Lesson['successfulStrategy'];
  failedAttempts?: Lesson['failedAttempts'];
  createdAt: string;
}

export class LessonLearner {
  private lessons: Map<string, Lesson> = new Map();
  private userLessons: Map<string, string[]> = new Map();
  private maxLessonsPerUser = 500;
  private maxLessonsTotal = 5000;

  async recordSuccess(
    userId: string,
    taskPattern: string,
    complexity: string,
    strategy: Lesson['successfulStrategy']
  ): Promise<Lesson> {
    const existingLesson = this.findLessonByPattern(userId, taskPattern);

    if (existingLesson) {
      existingLesson.successCount++;
      existingLesson.lastUsedAt = new Date();
      existingLesson.successfulStrategy = strategy;
      this.lessons.set(existingLesson.id, existingLesson);
      console.log(`[LessonLearner] Updated lesson "${taskPattern}" - success count: ${existingLesson.successCount}`);
      return existingLesson;
    }

    const newLesson: Lesson = {
      id: uuidv4(),
      userId,
      taskPattern: this.normalizePattern(taskPattern),
      complexity,
      successfulStrategy: strategy,
      successCount: 1,
      failureCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };

    this.lessons.set(newLesson.id, newLesson);
    this.addToUserLessons(userId, newLesson.id);

    console.log(`[LessonLearner] Created new lesson "${newLesson.taskPattern}" (success count: 1)`);
    this.cleanupIfNeeded();

    return newLesson;
  }

  async recordFailure(
    userId: string,
    taskPattern: string,
    failureInfo: {
      reason: string;
      whatWentWrong: string;
      attemptedStrategy?: Lesson['successfulStrategy'];
    }
  ): Promise<Lesson> {
    const existingLesson = this.findLessonByPattern(userId, taskPattern);

    if (existingLesson) {
      existingLesson.failureCount++;
      existingLesson.lastUsedAt = new Date();
      existingLesson.failedAttempts = existingLesson.failedAttempts || [];
      existingLesson.failedAttempts.push({
        reason: failureInfo.reason,
        whatWentWrong: failureInfo.whatWentWrong,
      });
      this.lessons.set(existingLesson.id, existingLesson);
      console.log(`[LessonLearner] Recorded failure for "${taskPattern}" - failure count: ${existingLesson.failureCount}`);
      return existingLesson;
    }

    const newLesson: Lesson = {
      id: uuidv4(),
      userId,
      taskPattern: this.normalizePattern(taskPattern),
      complexity: 'unknown',
      successfulStrategy: failureInfo.attemptedStrategy || {
        classification: 'unknown',
        skillsUsed: [],
        mcpsUsed: [],
      },
      failedAttempts: [{
        reason: failureInfo.reason,
        whatWentWrong: failureInfo.whatWentWrong,
      }],
      successCount: 0,
      failureCount: 1,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };

    this.lessons.set(newLesson.id, newLesson);
    this.addToUserLessons(userId, newLesson.id);
    this.cleanupIfNeeded();

    return newLesson;
  }

  async getLessonsFor(userId: string, taskPattern: string, limit = 5): Promise<Lesson[]> {
    const normalizedPattern = this.normalizePattern(taskPattern);
    const userLessonIds = this.userLessons.get(userId) || [];
    const matches: Lesson[] = [];

    for (const id of userLessonIds) {
      const lesson = this.lessons.get(id);
      if (!lesson) continue;

      if (this.patternsMatch(normalizedPattern, lesson.taskPattern)) {
        matches.push(lesson);
        if (matches.length >= limit) break;
      }
    }

    return matches.sort((a, b) => {
      const scoreA = a.successCount / (a.successCount + a.failureCount || 1);
      const scoreB = b.successCount / (b.successCount + b.failureCount || 1);
      return scoreB - scoreA;
    });
  }

  getLessonsSummary(userId: string): LessonSummary[] {
    const userLessonIds = this.userLessons.get(userId) || [];
    const summaries: LessonSummary[] = [];

    for (const id of userLessonIds) {
      const lesson = this.lessons.get(id);
      if (lesson) {
        summaries.push({
          id: lesson.id,
          taskPattern: lesson.taskPattern,
          successCount: lesson.successCount,
          failureCount: lesson.failureCount,
          lastUsedAt: lesson.lastUsedAt.toISOString(),
        });
      }
    }

    return summaries.sort((a, b) =>
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
    );
  }

  getLessonDetails(lessonId: string): LessonDetails | null {
    const lesson = this.lessons.get(lessonId);
    if (!lesson) return null;

    return {
      id: lesson.id,
      taskPattern: lesson.taskPattern,
      successCount: lesson.successCount,
      failureCount: lesson.failureCount,
      lastUsedAt: lesson.lastUsedAt.toISOString(),
      successfulStrategy: lesson.successfulStrategy,
      failedAttempts: lesson.failedAttempts,
      createdAt: lesson.createdAt.toISOString(),
    };
  }

  async deleteLesson(lessonId: string): Promise<boolean> {
    const lesson = this.lessons.get(lessonId);
    if (!lesson) return false;

    this.lessons.delete(lessonId);

    const userLessonIds = this.userLessons.get(lesson.userId);
    if (userLessonIds) {
      const idx = userLessonIds.indexOf(lessonId);
      if (idx > -1) userLessonIds.splice(idx, 1);
    }

    console.log(`[LessonLearner] Deleted lesson ${lessonId}`);
    return true;
  }

  clearUserLessons(userId: string): void {
    const userLessonIds = this.userLessons.get(userId) || [];
    for (const id of userLessonIds) {
      this.lessons.delete(id);
    }
    this.userLessons.delete(userId);
    console.log(`[LessonLearner] Cleared all lessons for user ${userId}`);
  }

  getStats(): {
    totalLessons: number;
    totalUsers: number;
    averageSuccessRate: number;
    topPatterns: Array<{ pattern: string; successCount: number }>;
  } {
    const allLessons = Array.from(this.lessons.values());
    let totalSuccess = 0;
    const patternCounts: Record<string, number> = {};

    for (const lesson of allLessons) {
      totalSuccess += lesson.successCount;
      patternCounts[lesson.taskPattern] = (patternCounts[lesson.taskPattern] || 0) + lesson.successCount;
    }

    const topPatterns = Object.entries(patternCounts)
      .map(([pattern, count]) => ({ pattern, successCount: count }))
      .sort((a, b) => b.successCount - a.successCount)
      .slice(0, 10);

    return {
      totalLessons: allLessons.length,
      totalUsers: this.userLessons.size,
      averageSuccessRate: allLessons.length > 0 ? totalSuccess / allLessons.length : 0,
      topPatterns,
    };
  }

  private normalizePattern(message: string): string {
    const lower = message.toLowerCase();

    if (/organiz|ordena|limpia/.test(lower)) return 'organizar_archivos';
    if (/busca|investiga|encuentra/.test(lower)) return 'buscar_informacion';
    if (/crea|escribe|genera.*archivo/.test(lower)) return 'crear_archivo';
    if (/lee|muestra|abre/.test(lower)) return 'leer_archivo';
    if (/resum|resume|sintetiza/.test(lower)) return 'resumir_contenido';
    if (/analiza|analisis/.test(lower)) return 'analizar_datos';
    if (/codigo|programa|script/.test(lower)) return 'desarrollo_codigo';

    const words = message.split(' ').slice(0, 3).join('_');
    return words.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }

  private patternsMatch(pattern1: string, pattern2: string): boolean {
    if (pattern1 === pattern2) return true;

    const p1Parts = pattern1.split('_');
    const p2Parts = pattern2.split('_');
    const common = p1Parts.filter(p => p2Parts.includes(p));
    return common.length >= Math.min(p1Parts.length, p2Parts.length) * 0.5;
  }

  private findLessonByPattern(userId: string, taskPattern: string): Lesson | null {
    const normalizedPattern = this.normalizePattern(taskPattern);
    const userLessonIds = this.userLessons.get(userId) || [];

    for (const id of userLessonIds) {
      const lesson = this.lessons.get(id);
      if (lesson && this.patternsMatch(normalizedPattern, lesson.taskPattern)) {
        return lesson;
      }
    }

    return null;
  }

  private addToUserLessons(userId: string, lessonId: string): void {
    const userLessonIds = this.userLessons.get(userId) || [];
    if (!userLessonIds.includes(lessonId)) {
      userLessonIds.push(lessonId);
      this.userLessons.set(userId, userLessonIds);
    }
  }

  private cleanupIfNeeded(): void {
    if (this.lessons.size <= this.maxLessonsTotal) return;

    const sortedLessons = Array.from(this.lessons.values())
      .sort((a, b) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime());

    const toRemove = sortedLessons.slice(0, Math.floor(this.lessons.size * 0.2));
    for (const lesson of toRemove) {
      this.lessons.delete(lesson.id);
      const userLessonIds = this.userLessons.get(lesson.userId);
      if (userLessonIds) {
        const idx = userLessonIds.indexOf(lesson.id);
        if (idx > -1) userLessonIds.splice(idx, 1);
      }
    }

    console.log(`[LessonLearner] Cleaned up ${toRemove.length} old lessons`);
  }
}

export const lessonLearner = new LessonLearner();