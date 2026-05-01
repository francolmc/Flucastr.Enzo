import { useState, useEffect } from 'react';
import { useEnzoStore } from './stores/enzoStore';
import ChatPage from './pages/ChatPage';
import StatsPage from './pages/StatsPage';
import ConfigPage from './pages/ConfigPage';
import SkillsPage from './pages/SkillsPage';
import MCPPage from './pages/MCPPage';
import DashboardPage from './pages/DashboardPage';
import MemoryPage from './pages/MemoryPage';
import ProjectsPage from './pages/ProjectsPage';
import EchoPage from './pages/EchoPage';
import CalendarPage from './pages/CalendarPage';
import EmailPage from './pages/EmailPage';
import { formatRelativeTime } from './utils/timeFormat';
import './App.css';

export type Page =
  | 'dashboard'
  | 'memory'
  | 'calendar'
  | 'projects'
  | 'echo'
  | 'chat'
  | 'stats'
  | 'skills'
  | 'mcp'
  | 'config'
  | 'email';

const NAV_ITEMS: Array<{
  id: Page;
  label: string;
  description: string;
  icon?: string;
}> = [
  { id: 'dashboard', label: 'Dashboard', description: 'Resumen del sistema', icon: '📊' },
  { id: 'memory', label: 'Memoria', description: 'Contexto persistente', icon: '🧠' },
  { id: 'projects', label: 'Proyectos', description: 'Vista por proyecto', icon: '🚀' },
  { id: 'calendar', label: 'Agenda', description: 'Eventos y horarios', icon: '📅' },
  { id: 'echo', label: 'Echo', description: 'Tareas programadas', icon: '🔄' },
  { id: 'chat', label: 'Chat', description: 'Conversaciones y contexto', icon: '💬' },
  { id: 'skills', label: 'Skills', description: 'Capacidades del asistente', icon: '⚡' },
  { id: 'email', label: 'Correo', description: 'IMAP Outlook / Gmail', icon: '📧' },
  { id: 'stats', label: 'Insights', description: 'Métricas y señales', icon: '📈' },
  { id: 'mcp', label: 'MCP', description: 'Conectores y tools', icon: '🔌' },
  { id: 'config', label: 'Config', description: 'Modelos y presets conversacionales', icon: '⚙️' },
];

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const {
    conversations,
    conversationId,
    loadConversations,
    loadConfig,
    loadAgents,
    newConversation,
    loadHistory,
    deleteConversation,
  } = useEnzoStore();

  useEffect(() => {
    void Promise.allSettled([loadConversations(), loadConfig(), loadAgents()]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const label = ['loadConversations', 'loadConfig', 'loadAgents'][i] ?? 'bootstrap';
          console.error(`[App] ${label} rejected:`, r.reason);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const activePage = NAV_ITEMS.find((item) => item.id === currentPage);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">ENZO</h1>
          <p className="logo-subtitle">Control center para asistentes amplificados</p>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.id)}
            >
              <span className="nav-item-title">
                {item.icon ? <span className="nav-icon">{item.icon}</span> : null}
                {item.label}
              </span>
              <span className="nav-item-subtitle">{item.description}</span>
            </button>
          ))}
        </nav>

        {currentPage === 'chat' && (
          <div className="conversations-list">
            <h3>Conversaciones recientes</h3>
            <div className="conversations-scroll">
              {conversations.length === 0 ? (
                <p className="empty-state">Sin conversaciones</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`conversation-item-wrapper ${
                      conversationId === conv.id ? 'active' : ''
                    }`}
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
          {currentPage === 'chat' && (
            <button className="new-conversation-btn" onClick={newConversation}>
              Nueva conversación
            </button>
          )}
        </div>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <div>
            <p className="main-header-kicker">Workspace Enzo</p>
            <h2>{activePage?.label}</h2>
            <p>{activePage?.description}</p>
          </div>
          <div className="main-header-meta">
            {currentPage === 'chat' && (
              <span className="badge">{conversations.length} conversaciones</span>
            )}
            <span className="badge">Operativo</span>
          </div>
        </header>
        {currentPage === 'dashboard' && (
          <DashboardPage onNavigate={(p) => setCurrentPage(p)} />
        )}
        {currentPage === 'memory' && <MemoryPage />}
        {currentPage === 'projects' && <ProjectsPage />}
        {currentPage === 'calendar' && <CalendarPage />}
        {currentPage === 'echo' && <EchoPage />}
        {currentPage === 'chat' && <ChatPage />}
        {currentPage === 'stats' && <StatsPage />}
        {currentPage === 'skills' && <SkillsPage />}
        {currentPage === 'email' && <EmailPage />}
        {currentPage === 'mcp' && <MCPPage />}
        {currentPage === 'config' && <ConfigPage />}
      </main>
    </div>
  );
}

export default App;
