import { useEffect, useMemo, useState } from 'react';
import { useEnzoStore } from '../stores/enzoStore';
import { MetricCard } from '../components/stats/MetricCard';
import { InsightCard } from '../components/stats/InsightCard';
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
        <MetricCard
          title="Mensajes totales"
          value={stats.totalMessages.toLocaleString()}
          icon="💬"
          color="primary"
        />
        <MetricCard
          title="Tokens totales"
          value={stats.totalTokens.toLocaleString()}
          icon="🔤"
          color="primary"
        />
        <MetricCard
          title="Latencia promedio"
          value={`${stats.averageDurationMs}ms`}
          icon="⚡"
          color={hasLatencyRisk ? 'warning' : 'success'}
        />
        <MetricCard
          title="Costo total"
          value={`$${stats.totalCostUsd.toFixed(4)}`}
          icon="💰"
          color={stats.totalCostUsd > 10 ? 'warning' : 'success'}
        />
        <MetricCard
          title="Costo por mensaje"
          value={`$${avgCostPerMessage.toFixed(4)}`}
          icon="📊"
          color="primary"
        />
        <MetricCard
          title="Provider más usado"
          value={mostUsedProvider}
          icon="🏆"
          color="primary"
        />
        <MetricCard
          title="Tokens por mensaje"
          value={avgTokensPerMessage.toLocaleString()}
          icon="📈"
          color="primary"
        />
        <MetricCard
          title="Complejidad dominante"
          value={mostUsedComplexity}
          icon="🎯"
          color="primary"
        />
      </div>

      <section className="insight-strip">
        <InsightCard
          type={hasLatencyRisk ? 'warning' : 'success'}
          title="Rendimiento"
          message={hasLatencyRisk 
            ? 'Detectamos latencia alta en las respuestas.' 
            : 'El rendimiento es estable para el volumen actual.'}
          recommendation={hasLatencyRisk 
            ? 'Considera ajustar el modelo principal o configurar modelos fallback más rápidos.' 
            : 'Mantén la configuración actual para un rendimiento óptimo.'}
        />
        <InsightCard
          type={hasProviderConcentrationRisk ? 'warning' : 'success'}
          title="Distribución de carga"
          message={hasProviderConcentrationRisk 
            ? 'Un provider concentra más del 75% del tráfico.' 
            : 'Uso distribuido sin riesgo alto de dependencia.'}
          recommendation={hasProviderConcentrationRisk 
            ? 'Configura múltiples providers para mejorar la resiliencia y disponibilidad.' 
            : 'Continúa con la estrategia de balanceo actual.'}
        />
        <InsightCard
          type={hasCostConcentrationRisk ? 'warning' : 'success'}
          title="Optimización de costos"
          message={hasCostConcentrationRisk 
            ? 'Más del 80% del costo se concentra en un solo provider.' 
            : 'Costo razonablemente distribuido entre providers.'}
          recommendation={hasCostConcentrationRisk 
            ? 'Considera usar modelos más económicos para tareas simples y reservar los costosos para tareas complejas.' 
            : 'La estrategia de costos actual es eficiente.'}
        />
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
