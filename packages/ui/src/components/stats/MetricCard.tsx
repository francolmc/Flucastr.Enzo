interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'primary' | 'success' | 'warning' | 'error';
  icon?: string;
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  trend, 
  trendValue, 
  color = 'primary', 
  icon 
}: MetricCardProps) {
  const getColorClass = () => {
    switch (color) {
      case 'success': return 'metric-success';
      case 'warning': return 'metric-warning';
      case 'error': return 'metric-error';
      default: return 'metric-primary';
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case 'up': return '📈';
      case 'down': return '📉';
      default: return '➡️';
    }
  };

  return (
    <div className={`metric-card ${getColorClass()}`}>
      <div className="metric-header">
        {icon && <span className="metric-icon">{icon}</span>}
        <div className="metric-title">{title}</div>
      </div>
      <div className="metric-value">{value}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
      {trend && trendValue && (
        <div className="metric-trend">
          <span className="trend-icon">{getTrendIcon()}</span>
          <span className="trend-value">{trendValue}</span>
        </div>
      )}
    </div>
  );
}
