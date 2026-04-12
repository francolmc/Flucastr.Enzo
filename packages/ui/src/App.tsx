import { useState, useEffect } from 'react';
import { useEnzoStore } from './stores/enzoStore';
import ChatPage from './pages/ChatPage';
import StatsPage from './pages/StatsPage';
import ConfigPage from './pages/ConfigPage';
import SkillsPage from './pages/SkillsPage';
import MCPPage from './pages/MCPPage';
import './App.css';

type Page = 'chat' | 'stats' | 'skills' | 'mcp' | 'config';

const NAV_ITEMS: Array<{
  id: Page;
  label: string;
  description: string;
}> = [
  { id: 'chat', label: 'Chat', description: 'Conversaciones y contexto' },
  { id: 'stats', label: 'Insights', description: 'Métricas y señales' },
  { id: 'skills', label: 'Skills', description: 'Capacidades del asistente' },
  { id: 'mcp', label: 'MCP', description: 'Conectores y tools' },
  { id: 'config', label: 'Config', description: 'Modelos y agentes' },
];

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const deltaMinutes = Math.floor(deltaMs / 60000);
  if (deltaMinutes < 1) return 'ahora';
  if (deltaMinutes < 60) return `hace ${deltaMinutes} min`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `hace ${deltaHours} h`;
  return new Date(timestamp).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
  });
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
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
    loadConversations();
    loadConfig();
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo ejecutar una vez al montar

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
              <span className="nav-item-title">{item.label}</span>
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
            <span className="badge">{conversations.length} conversaciones</span>
            <span className="badge">Operativo</span>
          </div>
        </header>
        {currentPage === 'chat' && <ChatPage />}
        {currentPage === 'stats' && <StatsPage />}
        {currentPage === 'skills' && <SkillsPage />}
        {currentPage === 'mcp' && <MCPPage />}
        {currentPage === 'config' && <ConfigPage />}
      </main>
    </div>
  );
}

export default App;
