export type DecisionPhase =
  | 'classification'
  | 'skill_resolution'
  | 'mcp_resolution'
  | 'decomposition'
  | 'execution'
  | 'synthesis'
  | 'delegation';

export interface DecisionLog {
  timestamp: Date;
  requestId: string;
  userId: string;
  phase: DecisionPhase;
  decision: Record<string, unknown>;
  reasoning: string;
  alternatives?: string[];
  metadata?: Record<string, unknown>;
}

export interface DecisionSummary {
  requestId: string;
  userId: string;
  timestamp: Date;
  phases: {
    classification?: {
      level: string;
      reason: string;
      hints: Record<string, unknown>;
    };
    skills?: {
      considered: string[];
      selected: string[];
    };
    mcps?: {
      considered: string[];
      selected: string[];
    };
    decomposition?: {
      steps: number;
      tools: string[];
    };
    execution?: {
      iterations: number;
      toolsUsed: string[];
      delegation?: {
        agent: string;
        reason: string;
      };
    };
  };
}

export class DecisionLogger {
  private logs: Map<string, DecisionLog[]> = new Map();
  private userLogs: Map<string, DecisionLog[]> = new Map();
  private maxLogsPerRequest = 100;
  private maxUserLogs = 1000;

  logDecision(log: Omit<DecisionLog, 'timestamp'>): void {
    const fullLog: DecisionLog = {
      ...log,
      timestamp: new Date(),
    };

    const requestLogs = this.logs.get(log.requestId) || [];
    requestLogs.push(fullLog);
    this.logs.set(log.requestId, requestLogs);

    const userLogs = this.userLogs.get(log.userId) || [];
    userLogs.push(fullLog);

    if (userLogs.length > this.maxUserLogs) {
      userLogs.splice(0, userLogs.length - this.maxUserLogs);
    }
    this.userLogs.set(log.userId, userLogs);

    if (process.env.ENZO_DEBUG === 'true') {
      console.log(JSON.stringify({
        event: 'EnzoDecision',
        phase: log.phase,
        requestId: log.requestId,
        userId: log.userId,
        ...log.decision,
      }));
    }
  }

  getLogsForRequest(requestId: string): DecisionLog[] {
    return this.logs.get(requestId) || [];
  }

  getLogsForUser(userId: string, limit = 100): DecisionLog[] {
    const logs = this.userLogs.get(userId) || [];
    return logs.slice(-limit);
  }

  getRecentLogs(limit = 100): DecisionLog[] {
    const allLogs: DecisionLog[] = [];
    for (const logs of this.logs.values()) {
      allLogs.push(...logs);
    }
    return allLogs
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  getSummary(requestId: string): DecisionSummary | null {
    const logs = this.getLogsForRequest(requestId);
    if (logs.length === 0) return null;

    const first = logs[0];
    const summary: DecisionSummary = {
      requestId,
      userId: first.userId,
      timestamp: first.timestamp,
      phases: {},
    };

    for (const log of logs) {
      switch (log.phase) {
        case 'classification':
          summary.phases.classification = {
            level: String(log.decision.level || ''),
            reason: String(log.reasoning || ''),
            hints: log.decision as Record<string, unknown>,
          };
          break;
        case 'skill_resolution':
          summary.phases.skills = {
            considered: (log.decision.considered as string[]) || [],
            selected: (log.decision.selected as string[]) || [],
          };
          break;
        case 'mcp_resolution':
          summary.phases.mcps = {
            considered: (log.decision.considered as string[]) || [],
            selected: (log.decision.selected as string[]) || [],
          };
          break;
        case 'decomposition':
          summary.phases.decomposition = {
            steps: Number(log.decision.stepCount || 0),
            tools: (log.decision.tools as string[]) || [],
          };
          break;
        case 'execution':
          summary.phases.execution = {
            iterations: Number(log.decision.iterations || 0),
            toolsUsed: (log.decision.toolsUsed as string[]) || [],
            delegation: log.decision.delegation as { agent: string; reason: string } | undefined,
          };
          break;
      }
    }

    return summary;
  }

  clear(): void {
    this.logs.clear();
    this.userLogs.clear();
  }

  clearUserLogs(userId: string): void {
    this.userLogs.delete(userId);
  }

  getStats(): {
    totalRequests: number;
    totalDecisions: number;
    phaseDistribution: Record<string, number>;
  } {
    const phaseDistribution: Record<string, number> = {};
    let totalDecisions = 0;

    for (const logs of this.logs.values()) {
      totalDecisions += logs.length;
      for (const log of logs) {
        phaseDistribution[log.phase] = (phaseDistribution[log.phase] || 0) + 1;
      }
    }

    return {
      totalRequests: this.logs.size,
      totalDecisions,
      phaseDistribution,
    };
  }
}

export const decisionLogger = new DecisionLogger();