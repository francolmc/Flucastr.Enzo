interface InsightCardProps {
  type: 'warning' | 'info' | 'success' | 'error';
  title: string;
  message: string;
  recommendation?: string;
  value?: number;
}

export function InsightCard({ type, title, message, recommendation, value }: InsightCardProps) {
  const getTypeClass = () => {
    switch (type) {
      case 'warning': return 'insight-warning';
      case 'error': return 'insight-error';
      case 'success': return 'insight-success';
      default: return 'insight-info';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'warning': return '⚠️';
      case 'error': return '❌';
      case 'success': return '✅';
      default: return 'ℹ️';
    }
  };

  return (
    <div className={`insight-card ${getTypeClass()}`}>
      <div className="insight-header">
        <span className="insight-icon">{getIcon()}</span>
        <h3>{title}</h3>
        {value !== undefined && <span className="insight-value">{value}%</span>}
      </div>
      <p className="insight-message">{message}</p>
      {recommendation && (
        <div className="insight-recommendation">
          <strong>Recomendación:</strong> {recommendation}
        </div>
      )}
    </div>
  );
}
