import { useState, useEffect } from 'react';
import { useEnzoStore } from './stores/enzoStore';
import { apiClient } from './api/client';
import ChatPage from './pages/ChatPage';
import StatsPage from './pages/StatsPage';
import SkillsPage from './pages/SkillsPage';
import MCPPage from './pages/MCPPage';
import DashboardPage from './pages/DashboardPage';
import MemoryPage from './pages/MemoryPage';
import EchoPage from './pages/EchoPage';
import SettingsPage from './pages/SettingsPage';
import { formatRelativeTime } from './utils/timeFormat';
import './App.css';

export type Page =
  | 'chat'
  | 'dashboard'
  | 'mcp'
  | 'skills'
  | 'echo'
  | 'memory'
  | 'stats'
  | 'settings';

interface NavItem {
  id: Page;
  label: string;
  icon: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: 'chat', label: 'Chat', icon: 'fa-regular fa-comments' },
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-grip' },
    ]
  },
  {
    label: 'Capacidades',
    items: [
      { id: 'mcp', label: 'MCPs', icon: 'fa-solid fa-plug' },
      { id: 'skills', label: 'Skills', icon: 'fa-solid fa-bolt' },
      { id: 'echo', label: 'Echo', icon: 'fa-regular fa-clock' },
    ]
  },
  {
    label: 'Personal',
    items: [
      { id: 'memory', label: 'Memoria', icon: 'fa-solid fa-brain' },
      { id: 'stats', label: 'Estadísticas', icon: 'fa-solid fa-chart-simple' },
    ]
  },
  {
    label: 'Sistema',
    items: [
      { id: 'settings', label: 'Configuración', icon: 'fa-solid fa-gear' },
    ]
  },
];

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const {
    conversations,
    conversationId,
    loadConversations,
    loadConfig,
    loadAgents,
    loadModelsConfig,
    loadHistory,
    deleteConversation,
    modelsConfig,
  } = useEnzoStore();

  const [connectedMcpCount, setConnectedMcpCount] = useState<number>(0);

  useEffect(() => {
    void Promise.allSettled([loadConversations(), loadConfig(), loadAgents(), loadModelsConfig()]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const label = ['loadConversations', 'loadConfig', 'loadAgents', 'loadModelsConfig'][i] ?? 'bootstrap';
          console.error(`[App] ${label} rejected:`, r.reason);
        }
      });
    });
  }, [loadConversations, loadConfig, loadAgents, loadModelsConfig]);

  useEffect(() => {
    apiClient.getMCPServers().then((servers) => {
      const connected = servers.filter((s: any) => s.status === 'connected').length;
      setConnectedMcpCount(connected);
    }).catch(() => {
      setConnectedMcpCount(0);
    });
  }, []);

  const handleSelectConversation = async (id: string) => {
    await loadHistory(id);
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('¿Estás seguro de que deseas eliminar esta conversación?')) {
      return;
    }

    try {
      await deleteConversation(id);
    } catch (error) {
      console.error('No se pudo eliminar la conversación:', error);
      alert('No se pudo eliminar la conversación. Revisa que la API esté disponible.');
    }
  };

  const activePage = NAV_GROUPS.flatMap(g => g.items).find(item => item.id === currentPage);
  const modelName = modelsConfig?.primaryModel || '—';
  const conversationBadge = conversations.length > 0 ? conversations.length : null;

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>ENZO</h1>
          <p>Asistente personal</p>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="nav-group">
              {group.label && <div className="nav-group-label">{group.label}</div>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => setCurrentPage(item.id)}
                >
                  <i className={`${item.icon}`} />
                  {item.label}
                  {item.id === 'chat' && conversationBadge !== null && (
                    <span className="nav-badge">{conversationBadge}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {currentPage === 'chat' && (
          <div className="conversations-section">
            <h3>Conversaciones</h3>
            <div className="conversations-scroll">
              {conversations.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>Sin conversaciones</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`conversation-item-wrapper ${conversationId === conv.id ? 'active' : ''}`}
                  >
                    <button
                      className="conversation-item"
                      onClick={() => handleSelectConversation(conv.id)}
                    >
                      <span className="conv-title">Sesión {conv.id.slice(-4)}</span>
                      <span className="conv-date">
                        {formatRelativeTime(conv.updatedAt || conv.createdAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="delete-conversation-btn"
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      title="Eliminar conversación"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span className="status-text">{modelName} · {connectedMcpCount} MCPs</span>
        </div>
      </aside>

      <main className={currentPage === 'chat' ? 'main-content main-content--chat' : 'main-content'}>
        <header className="main-header">
          <div>
            <h2>{activePage?.label}</h2>
          </div>
          <div className="main-header-meta">
            {currentPage === 'chat' && (
              <span className="badge">{conversations.length} conversaciones</span>
            )}
          </div>
        </header>
        <div className={currentPage === 'chat' ? 'main-body main-body--chat' : 'main-body'}>
          {currentPage === 'dashboard' && (
            <DashboardPage onNavigate={(p) => setCurrentPage(p as Page)} />
          )}
          {currentPage === 'memory' && <MemoryPage />}
          {currentPage === 'echo' && <EchoPage />}
          {currentPage === 'chat' && <ChatPage />}
          {currentPage === 'stats' && <StatsPage />}
          {currentPage === 'skills' && <SkillsPage />}
          {currentPage === 'mcp' && <MCPPage />}
          {currentPage === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}

export default App;