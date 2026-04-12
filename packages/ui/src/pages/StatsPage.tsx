import { useEffect, useMemo, useState } from 'react';
import { useEnzoStore } from '../stores/enzoStore';
import './StatsPage.css';

type SourceFilter = 'all' | 'web' | 'telegram' | 'unknown';

function StatsPage() {
  const { stats, loadStats } = useEnzoStore();
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const statsFilters = useMemo(() => {
    const now = Date.now();
    const from = now - rangeDays * 24 * 60 * 60 * 1000;
    return {
      from,
      to: now,
      source: sourceFilter === 'all' ? undefined : sourceFilter,
    };
  }, [rangeDays, sourceFilter]);

  useEffect(() => {
    loadStats(statsFilters);
  }, [loadStats, statsFilters]);

  if (!stats) {
    return <div className="stats-page">Cargando estadísticas...</div>;
  }

  const mostUsedProvider =
    stats.byProvider.length > 0
      ? stats.byProvider.reduce((prev, current) =>
          prev.count > current.count ? prev : current
        ).provider
      : 'N/A';
  const avgTokensPerMessage =
    stats.totalMessages > 0 ? Math.round(stats.totalTokens / stats.totalMessages) : 0;
  const avgCostPerMessage =
    stats.totalMessages > 0 ? stats.totalCostUsd / stats.totalMessages : 0;
  const hasLatencyRisk = stats.averageDurationMs > 3000;
  const hasProviderConcentrationRisk =
    stats.byProvider.length > 0 &&
    stats.byProvider.reduce((acc, item) => acc + item.count, 0) > 0 &&
    stats.byProvider.some(
      (item) => item.count / stats.byProvider.reduce((acc, p) => acc + p.count, 0) > 0.75
    );
  const hasCostConcentrationRisk =
    stats.byProvider.length > 0 &&
    stats.totalCostUsd > 0 &&
    stats.byProvider.some((item) => item.costUsd / stats.totalCostUsd > 0.8);
  const mostUsedComplexity = stats.byComplexity.length
    ? stats.byComplexity.reduce((prev, curr) => (prev.count > curr.count ? prev : curr)).level
    : 'N/A';
  const topCostProvider = stats.byProvider.length
    ? stats.byProvider.reduce((prev, curr) => (prev.costUsd > curr.costUsd ? prev : curr)).provider
    : 'N/A';
  const byModelTop = [...stats.byModel].sort((a, b) => b.costUsd - a.costUsd).slice(0, 8);

  return (
    <div className="stats-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">InsightsBoard</h1>
          <p className="page-subtitle">
            Lectura rápida de uso, latencia y confiabilidad para tomar decisiones operativas.
          </p>
        </div>
        <div className="stats-filters">
          <label>
            Rango
            <select
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value) as 7 | 30 | 90)}
            >
              <option value={7}>7d</option>
              <option value={30}>30d</option>
              <option value={90}>90d</option>
            </select>
          </label>
          <label>
            Canal
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            >
              <option value="all">Todos</option>
              <option value="web">Web</option>
              <option value="telegram">Telegram</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>
      </div>

      <div className="stats-cards">
        <div className="stat-card surface-card">
          <div className="stat-value">{stats.totalMessages}</div>
          <div className="stat-label">Mensajes totales</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">{stats.totalTokens.toLocaleString()}</div>
          <div className="stat-label">Tokens totales</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">{stats.averageDurationMs}ms</div>
          <div className="stat-label">Latencia promedio</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">${stats.totalCostUsd.toFixed(4)}</div>
          <div className="stat-label">Costo total (USD)</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">${avgCostPerMessage.toFixed(4)}</div>
          <div className="stat-label">Costo por mensaje</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">{mostUsedProvider}</div>
          <div className="stat-label">Provider más usado</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">{topCostProvider}</div>
          <div className="stat-label">Provider más costoso</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">{avgTokensPerMessage}</div>
          <div className="stat-label">Tokens por mensaje</div>
        </div>
        <div className="stat-card surface-card">
          <div className="stat-value">{mostUsedComplexity}</div>
          <div className="stat-label">Complejidad dominante</div>
        </div>
      </div>

      <section className="insight-strip">
        <article className={`insight-card ${hasLatencyRisk ? 'warning' : 'ok'}`}>
          <h3>Latencia</h3>
          <p>
            {hasLatencyRisk
              ? 'Detectamos latencia alta. Considera ajustar modelo principal/fallback.'
              : 'Latencia estable para el volumen actual.'}
          </p>
        </article>
        <article className={`insight-card ${hasProviderConcentrationRisk ? 'warning' : 'ok'}`}>
          <h3>Concentración por provider</h3>
          <p>
            {hasProviderConcentrationRisk
              ? 'Un provider concentra más del 75% del tráfico; evalúa balanceo.'
              : 'Uso distribuido sin riesgo alto de dependencia.'}
          </p>
        </article>
        <article className={`insight-card ${hasCostConcentrationRisk ? 'warning' : 'ok'}`}>
          <h3>Concentración de costo</h3>
          <p>
            {hasCostConcentrationRisk
              ? 'Más del 80% del costo cae en un solo provider. Considera mix de modelos.'
              : 'Costo razonablemente distribuido entre providers.'}
          </p>
        </article>
      </section>

      <div className="stats-tables">
        <div className="table-section surface-card">
          <h2>Uso por Provider</h2>
          {stats.byProvider.length === 0 ? (
            <p className="empty-state">Sin datos</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Mensajes</th>
                  <th>Tokens</th>
                  <th>Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {stats.byProvider.map((item) => (
                  <tr key={item.provider}>
                    <td>{item.provider}</td>
                    <td>{item.count}</td>
                    <td>{item.tokens.toLocaleString()}</td>
                    <td>${item.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-section surface-card">
          <h2>Uso por Complejidad</h2>
          {stats.byComplexity.length === 0 ? (
            <p className="empty-state">Sin datos</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Nivel</th>
                  <th>Conteo</th>
                </tr>
              </thead>
              <tbody>
                {stats.byComplexity.map((item) => (
                  <tr key={item.level}>
                    <td>{item.level}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="stats-tables stats-tables-triple">
        <div className="table-section surface-card">
          <h2>Split por Canal</h2>
          {stats.bySource.length === 0 ? (
            <p className="empty-state">Sin datos</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Mensajes</th>
                  <th>Tokens</th>
                  <th>Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {stats.bySource.map((item) => (
                  <tr key={item.source}>
                    <td>{item.source}</td>
                    <td>{item.count}</td>
                    <td>{item.tokens.toLocaleString()}</td>
                    <td>${item.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-section surface-card">
          <h2>Tendencia diaria</h2>
          {stats.byDay.length === 0 ? (
            <p className="empty-state">Sin datos</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Mensajes</th>
                  <th>Tokens</th>
                  <th>Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {stats.byDay.map((item) => (
                  <tr key={item.date}>
                    <td>{item.date}</td>
                    <td>{item.count}</td>
                    <td>{item.tokens.toLocaleString()}</td>
                    <td>${item.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-section surface-card">
          <h2>Modelos con mayor costo</h2>
          {byModelTop.length === 0 ? (
            <p className="empty-state">Sin datos</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Provider</th>
                  <th>Mensajes</th>
                  <th>Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {byModelTop.map((item) => (
                  <tr key={`${item.provider}-${item.model}`}>
                    <td>{item.model}</td>
                    <td>{item.provider}</td>
                    <td>{item.count}</td>
                    <td>${item.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="stats-tables">
        <div className="table-section surface-card">
          <h2>Top tools/skills usados</h2>
          {stats.byTool.length === 0 ? (
            <p className="empty-state">Sin datos</p>
          ) : (
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Tool/skill</th>
                  <th>Uso</th>
                </tr>
              </thead>
              <tbody>
                {stats.byTool.slice(0, 12).map((item) => (
                  <tr key={item.tool}>
                    <td>{item.tool}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default StatsPage;
