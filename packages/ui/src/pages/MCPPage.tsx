import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import './MCPPage.css';

interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  error?: string;
  toolCount: number;
  lastConnectedAt?: number;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
  serverId: string;
}

interface FormData {
  name: string;
  description: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string;
  url: string;
}

const initialFormData: FormData = {
  name: '',
  description: '',
  transport: 'stdio',
  command: 'npx',
  args: '',
  url: '',
};

export default function MCPPage() {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadServers();
    loadTools();
    const interval = setInterval(() => {
      loadServers();
      loadTools();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadServers = async () => {
    try {
      const data = await apiClient.getMCPServers();
      setServers(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error loading servers:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTools = async () => {
    try {
      const data = await apiClient.getMCPTools();
      setTools(data);
    } catch (err) {
      console.error('Error loading tools:', err);
    }
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.transport) {
      setError('Por favor completa los campos requeridos');
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        name: formData.name,
        description: formData.description || undefined,
        transport: formData.transport,
        enabled: true,
      };

      if (formData.transport === 'stdio') {
        payload.command = formData.command;
        if (formData.args.trim()) {
          payload.args = formData.args.split(/\s+/).filter((a: string) => a.length > 0);
        }
      } else {
        payload.url = formData.url;
      }

      await apiClient.connectMCPServer(payload);
      setFormData(initialFormData);
      setShowForm(false);
      await loadServers();
      await loadTools();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error adding server:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconnect = async (serverId: string) => {
    try {
      await apiClient.reconnectMCPServer(serverId);
      await loadServers();
      await loadTools();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error reconnecting:', err);
    }
  };

  const handleToggle = async (serverId: string, enabled: boolean) => {
    try {
      await apiClient.toggleMCPServer(serverId, enabled);
      await loadServers();
      await loadTools();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error toggling server:', err);
    }
  };

  const handleDelete = async (serverId: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este servidor MCP?')) {
      return;
    }
    try {
      await apiClient.disconnectMCPServer(serverId);
      await loadServers();
      await loadTools();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('Error deleting server:', err);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return '✅';
      case 'error':
        return '❌';
      case 'connecting':
        return '⏳';
      default:
        return '⏸️';
    }
  };

  const toolsByServer = servers.reduce((acc, server) => {
    const serverTools = tools.filter(t => t.serverId === server.id);
    if (serverTools.length > 0) {
      acc[server.id] = serverTools;
    }
    return acc;
  }, {} as Record<string, MCPTool[]>);

  return (
    <div className="mcp-page page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">MCP ControlCenter</h1>
          <p className="page-subtitle">
            Conecta servidores de tools, monitoriza su estado y valida disponibilidad operativa.
          </p>
        </div>
        <button
          className="btn-add-server"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancelar' : 'Agregar servidor'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="mcp-kpis">
        <article className="surface-card mcp-kpi-card">
          <span>Servidores</span>
          <strong>{servers.length}</strong>
        </article>
        <article className="surface-card mcp-kpi-card">
          <span>Conectados</span>
          <strong>{servers.filter((server) => server.status === 'connected').length}</strong>
        </article>
        <article className="surface-card mcp-kpi-card">
          <span>Tools totales</span>
          <strong>{tools.length}</strong>
        </article>
      </div>

      {showForm && (
        <div className="add-server-form surface-card">
          <h3>Agregar nuevo servidor MCP</h3>
          <form onSubmit={handleAddServer}>
            <div className="form-group">
              <label>Nombre *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="ej: filesystem, mistral-server"
              />
            </div>

            <div className="form-group">
              <label>Descripción</label>
              <input
                type="text"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descripción del servidor (opcional)"
              />
            </div>

            <div className="form-group">
              <label>Tipo de transporte *</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="stdio"
                    checked={formData.transport === 'stdio'}
                    onChange={e => setFormData({ ...formData, transport: e.target.value as 'stdio' })}
                  />
                  stdio (ejecutar comando localmente)
                </label>
                <label>
                  <input
                    type="radio"
                    value="sse"
                    checked={formData.transport === 'sse'}
                    onChange={e => setFormData({ ...formData, transport: e.target.value as 'sse' })}
                  />
                  SSE (servidor remoto)
                </label>
              </div>
            </div>

            {formData.transport === 'stdio' && (
              <>
                <div className="form-group">
                  <label>Comando *</label>
                  <input
                    type="text"
                    value={formData.command}
                    onChange={e => setFormData({ ...formData, command: e.target.value })}
                    placeholder="ej: npx"
                  />
                </div>
                <div className="form-group">
                  <label>Argumentos *</label>
                  <input
                    type="text"
                    value={formData.args}
                    onChange={e => setFormData({ ...formData, args: e.target.value })}
                    placeholder="ej: -y @modelcontextprotocol/server-filesystem /Users/franco"
                  />
                </div>
              </>
            )}

            {formData.transport === 'sse' && (
              <div className="form-group">
                <label>URL *</label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={e => setFormData({ ...formData, url: e.target.value })}
                  placeholder="ej: http://localhost:3100/sse"
                />
              </div>
            )}

            <button
              type="submit"
              className="btn-submit"
              disabled={submitting}
            >
              {submitting ? 'Agregando...' : 'Agregar y conectar'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading">Cargando servidores MCP...</div>
      ) : servers.length === 0 ? (
        <div className="empty-state">
          <p>No hay servidores MCP configurados</p>
          <p className="hint">Haz clic en "Agregar Servidor" para comenzar</p>
        </div>
      ) : (
        <div className="servers-section">
          <h3>Servidores configurados</h3>
          <div className="servers-list">
            {servers.map((server) => (
              <div key={server.id} className="server-card surface-card">
                <div className="server-header">
                  <div className="server-info">
                    <h4>{server.name}</h4>
                    <p className="server-transport">{server.transport} · {getStatusIcon(server.status)} {server.status}</p>
                    {server.description && <p className="server-description">{server.description}</p>}
                    {server.transport === 'stdio' && (
                      <p className="server-config">
                        💻 {server.command} {server.args?.join(' ')}
                      </p>
                    )}
                    {server.transport === 'sse' && (
                      <p className="server-config">🌐 {server.url}</p>
                    )}
                    {server.error && (
                      <p className="server-error">Error: {server.error}</p>
                    )}
                  </div>
                  <div className="server-tools">
                    <span className="tool-count">{server.toolCount} tools</span>
                  </div>
                </div>
                <div className="server-actions">
                  <button
                    className="btn-action btn-reconnect"
                    onClick={() => handleReconnect(server.id)}
                    title="Reconectar servidor"
                  >
                    🔄 Reconectar
                  </button>
                  <button
                    className={`btn-action ${server.enabled ? 'btn-disable' : 'btn-enable'}`}
                    onClick={() => handleToggle(server.id, server.enabled)}
                    title={server.enabled ? 'Deshabilitar' : 'Habilitar'}
                  >
                    {server.enabled ? '⏸ Deshabilitar' : '▶ Habilitar'}
                  </button>
                  <button
                    className="btn-action btn-delete"
                    onClick={() => handleDelete(server.id)}
                    title="Eliminar servidor"
                  >
                    🗑 Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(toolsByServer).length > 0 && (
        <div className="tools-section">
          <h3>Tools disponibles</h3>
          <div className="tools-list">
            {servers.map((server) => {
              const serverTools = toolsByServer[server.id];
              if (!serverTools || serverTools.length === 0) return null;
              return (
                <div key={server.id} className="tools-group surface-card">
                  <h4>{server.name}</h4>
                  <div className="tools-items">
                    {serverTools.map((tool) => (
                      <div key={`${tool.serverId}_${tool.name}`} className="tool-item">
                        <div className="tool-name">{tool.name}</div>
                        <div className="tool-desc">{tool.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
