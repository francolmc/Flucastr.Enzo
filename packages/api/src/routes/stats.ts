import { Router, Request, Response } from 'express';
import { MemoryService, UsageStat, getRetryMetrics, getCircuitMetrics } from '@enzo/core';

interface StatsResponse {
  totalMessages: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Array<{ provider: string; count: number; tokens: number; costUsd: number }>;
  bySource: Array<{ source: string; count: number; tokens: number; costUsd: number }>;
  byModel: Array<{ model: string; provider: string; count: number; tokens: number; costUsd: number }>;
  byComplexity: Array<{ level: string; count: number }>;
  byTool: Array<{ tool: string; count: number }>;
  byDay: Array<{ date: string; count: number; tokens: number; costUsd: number }>;
  averageDurationMs: number;
  p95DurationMs: number;
  alerts: Array<{ code: string; message: string; severity: 'warning' | 'critical'; value: number }>;
}

export function createStatsRouter(memoryService: MemoryService): Router {
  const router = Router();

  router.get('/api/stats/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { from, to, source } = req.query;

      const fromTimestamp = typeof from === 'string' ? parseInt(from, 10) : undefined;
      const toTimestamp = typeof to === 'string' ? parseInt(to, 10) : undefined;
      const sourceFilter = source === 'web' || source === 'telegram' || source === 'unknown'
        ? source
        : undefined;

      console.log('[GET /api/stats/:userId] userId:', userId);
      const stats = await (memoryService as any).getStats(
        userId,
        Number.isFinite(fromTimestamp) ? fromTimestamp : undefined,
        Number.isFinite(toTimestamp) ? toTimestamp : undefined,
        sourceFilter
      ) as UsageStat[];
      console.log('[GET /api/stats/:userId] stats count:', stats.length);

      // Calculate aggregations
      let totalMessages = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      let totalDuration = 0;
      const providerMap = new Map<string, { count: number; tokens: number; costUsd: number }>();
      const sourceMap = new Map<string, { count: number; tokens: number; costUsd: number }>();
      const modelMap = new Map<string, { model: string; provider: string; count: number; tokens: number; costUsd: number }>();
      const complexityMap = new Map<string, number>();
      const toolMap = new Map<string, number>();
      const dayMap = new Map<string, { count: number; tokens: number; costUsd: number }>();

      for (const stat of stats) {
        totalMessages++;
        const tokens = stat.inputTokens + stat.outputTokens;
        const cost = stat.estimatedCostUsd || 0;
        totalTokens += tokens;
        totalCostUsd += cost;
        totalDuration += stat.durationMs;

        // By provider
        const existing = providerMap.get(stat.provider) || { count: 0, tokens: 0, costUsd: 0 };
        providerMap.set(stat.provider, {
          count: existing.count + 1,
          tokens: existing.tokens + tokens,
          costUsd: existing.costUsd + cost,
        });

        // By source
        const sourceKey = stat.source || 'unknown';
        const sourceExisting = sourceMap.get(sourceKey) || { count: 0, tokens: 0, costUsd: 0 };
        sourceMap.set(sourceKey, {
          count: sourceExisting.count + 1,
          tokens: sourceExisting.tokens + tokens,
          costUsd: sourceExisting.costUsd + cost,
        });

        // By model (provider + model)
        const modelKey = `${stat.provider}::${stat.model}`;
        const modelExisting = modelMap.get(modelKey) || {
          model: stat.model,
          provider: stat.provider,
          count: 0,
          tokens: 0,
          costUsd: 0,
        };
        modelMap.set(modelKey, {
          ...modelExisting,
          count: modelExisting.count + 1,
          tokens: modelExisting.tokens + tokens,
          costUsd: modelExisting.costUsd + cost,
        });

        // By complexity
        const complexityCount = complexityMap.get(stat.complexityLevel) || 0;
        complexityMap.set(stat.complexityLevel, complexityCount + 1);

        // By tool / skill
        for (const toolName of stat.toolsUsed || []) {
          const currentToolCount = toolMap.get(toolName) || 0;
          toolMap.set(toolName, currentToolCount + 1);
        }

        // By day (last 7 days)
        const date = new Date(stat.createdAt).toISOString().split('T')[0];
        const dayStats = dayMap.get(date) || { count: 0, tokens: 0, costUsd: 0 };
        dayMap.set(date, {
          count: dayStats.count + 1,
          tokens: dayStats.tokens + tokens,
          costUsd: dayStats.costUsd + cost,
        });
      }

      const byProvider = Array.from(providerMap.entries()).map(([provider, data]) => ({
        provider,
        count: data.count,
        tokens: data.tokens,
        costUsd: Number(data.costUsd.toFixed(8)),
      }));

      const bySource = Array.from(sourceMap.entries()).map(([sourceName, data]) => ({
        source: sourceName,
        count: data.count,
        tokens: data.tokens,
        costUsd: Number(data.costUsd.toFixed(8)),
      }));

      const byModel = Array.from(modelMap.values())
        .map((item) => ({
          ...item,
          costUsd: Number(item.costUsd.toFixed(8)),
        }))
        .sort((a, b) => b.costUsd - a.costUsd);

      const byComplexity = Array.from(complexityMap.entries()).map(([level, count]) => ({
        level,
        count,
      }));
      const byTool = Array.from(toolMap.entries())
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count);

      const byDay = Array.from(dayMap.entries())
        .map(([date, data]) => ({
          date,
          count: data.count,
          tokens: data.tokens,
          costUsd: Number(data.costUsd.toFixed(8)),
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-30);

      const averageDurationMs = stats.length > 0 ? Math.round(totalDuration / stats.length) : 0;
      const sortedDurations = stats.map((item) => item.durationMs).sort((a, b) => a - b);
      const p95Index = sortedDurations.length === 0 ? 0 : Math.floor(0.95 * (sortedDurations.length - 1));
      const p95DurationMs = sortedDurations.length === 0 ? 0 : sortedDurations[p95Index];
      const alerts: StatsResponse['alerts'] = [];
      if (p95DurationMs > 25_000) {
        alerts.push({
          code: 'LATENCY_P95_HIGH',
          message: 'p95 latency exceeded 25s threshold.',
          severity: 'critical',
          value: p95DurationMs,
        });
      }
      const actStageTotals = stats.reduce(
        (acc, stat) => {
          const stage = stat.stageMetrics?.act;
          if (!stage) return acc;
          acc.count += stage.count || 0;
          acc.errors += stage.errorCount || 0;
          return acc;
        },
        { count: 0, errors: 0 }
      );
      const toolFailureRate = actStageTotals.count > 0 ? actStageTotals.errors / actStageTotals.count : 0;
      if (toolFailureRate > 0.1) {
        alerts.push({
          code: 'TOOL_FAILURE_RATE_HIGH',
          message: 'Tool action failure rate exceeded 10%.',
          severity: 'warning',
          value: Number((toolFailureRate * 100).toFixed(2)),
        });
      }
      const retryMetrics = getRetryMetrics();
      const retryRecoveryRate = retryMetrics.attemptsTotal > 0
        ? retryMetrics.recoveredTotal / retryMetrics.attemptsTotal
        : 1;
      if (retryRecoveryRate < 0.7) {
        alerts.push({
          code: 'RETRY_RECOVERY_LOW',
          message: 'Retry recovery ratio dropped below 70%.',
          severity: 'warning',
          value: Number((retryRecoveryRate * 100).toFixed(2)),
        });
      }
      const circuitMetrics = getCircuitMetrics();
      if (circuitMetrics.shortCircuitTotal > 0) {
        alerts.push({
          code: 'CIRCUIT_SHORT_CIRCUIT_ACTIVE',
          message: 'Some requests are being short-circuited by provider circuit breaker.',
          severity: 'warning',
          value: circuitMetrics.shortCircuitTotal,
        });
      }

      const response: StatsResponse = {
        totalMessages,
        totalTokens,
        totalCostUsd: Number(totalCostUsd.toFixed(8)),
        byProvider,
        bySource,
        byModel,
        byComplexity,
        byTool,
        byDay,
        averageDurationMs,
        p95DurationMs,
        alerts,
      };

      res.json(response);
    } catch (error) {
      console.error('[GET /api/stats/:userId] error:', error);
      res.status(500).json({
        error: 'RetrievalError',
        message: error instanceof Error ? error.message : 'Failed to retrieve stats',
        statusCode: 500,
      });
    }
  });

  return router;
}
