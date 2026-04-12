import { useState, useEffect, useRef } from 'react';
import { useEnzoStore } from '../stores/enzoStore';
import './ChatPage.css';

const ENV = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const STREAMING_ENABLED = (ENV.VITE_CHAT_STREAMING ?? 'true') !== 'false';

function ChatPage() {
  const [inputValue, setInputValue] = useState('');
  const [showErrorBanner, setShowErrorBanner] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastSubmittedMessage, setLastSubmittedMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    agents,
    selectedAgentId,
    assistantProfile,
    isThinking,
    sendMessage,
    sendMessageStream,
    cancelStreaming,
    getMessageStatus,
    setSelectedAgentId,
  } = useEnzoStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  const runMessage = async (message: string) => {
    if (!message.trim()) return;
    if (isThinking) {
      console.warn('[ChatPage] Already processing a message, ignoring...');
      return;
    }

    setInputValue('');
    setShowErrorBanner(false);
    setLastSubmittedMessage(message);

    try {
      if (STREAMING_ENABLED) {
        await sendMessageStream(message);
      } else {
        await sendMessage(message);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      console.error('Failed to send message:', error);
      setErrorMessage(errMsg);
      setShowErrorBanner(true);
    }
  };

  const handleSendMessage = async () => {
    await runMessage(inputValue);
  };

  const retryLastMessage = async () => {
    await runMessage(lastSubmittedMessage);
  };

  const handleCancel = () => {
    cancelStreaming();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isThinking) { // Only allow if not already processing
        handleSendMessage();
      }
    }
  };

  const getMessageStatusInfo = (messageId: string) => {
    return getMessageStatus(messageId);
  };

  return (
    <div className="chat-page">
      {showErrorBanner && (
        <div className="error-banner">
          <p>
            Error de procesamiento: <span>{errorMessage}</span>
          </p>
          <div className="error-banner-actions">
            <button className="secondary" onClick={() => setShowErrorBanner(false)}>
              Cerrar
            </button>
            <button onClick={retryLastMessage} disabled={!lastSubmittedMessage || isThinking}>
              Reintentar
            </button>
          </div>
        </div>
      )}

      <div className="chat-header">
        <div>
          <h3>ChatHub</h3>
          <p>Modo respuesta completa activo para validar experiencia base.</p>
        </div>
        <div className="chat-agent-select">
          <label htmlFor="activeAgent">Agente activo</label>
          <select
            id="activeAgent"
            value={selectedAgentId || ''}
            onChange={(e) => setSelectedAgentId(e.target.value || null)}
            disabled={isThinking}
          >
            <option value="">
              Perfil global ({assistantProfile?.name || 'Enzo'})
            </option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <h2>Bienvenido a {assistantProfile?.name || 'Enzo'}</h2>
            <p>Empieza con una pregunta para planificar, investigar o ejecutar tareas.</p>
            <div className="starter-prompts">
              <button onClick={() => setInputValue('Resume el estado actual del workspace')}>
                Resumen de workspace
              </button>
              <button onClick={() => setInputValue('Dame 3 prioridades para hoy en este repo')}>
                Prioridades del día
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const status = getMessageStatusInfo(msg.id);
            return (
              <div key={msg.id} className={`message message-${msg.role}`}>
                <div className="message-content">
                  <p>{msg.content}</p>
                </div>
                {msg.role === 'assistant' && (
                  <>
                    {status?.state === 'failed' && (
                      <div className="message-error">
                        <span className="error-icon">!</span>
                        <span>{status.error}</span>
                        <button
                          className="retry-btn"
                          onClick={retryLastMessage}
                          disabled={!lastSubmittedMessage || isThinking}
                        >
                          Reintentar
                        </button>
                      </div>
                    )}
                    {status?.state === 'streaming' && (
                      <div className="message-streaming">
                        <span className="streaming-indicator">▌</span>
                        <span>Streaming...</span>
                      </div>
                    )}
                    {(msg.modelUsed || msg.complexityUsed || msg.durationMs || (msg.injectedSkills && msg.injectedSkills.length > 0)) && (
                      <details className="message-metadata">
                        <summary>Detalles de ejecución</summary>
                        <div>
                          {msg.modelUsed && <span>Modelo: {msg.modelUsed}</span>}
                          {msg.complexityUsed && <span>Complejidad: {msg.complexityUsed}</span>}
                          {msg.durationMs && <span>Tiempo: {msg.durationMs}ms</span>}
                          {msg.injectedSkills && msg.injectedSkills.length > 0 && (
                            <span>
                              Skills inyectados:{' '}
                              {msg.injectedSkills
                                .map((skill) => `${skill.name} (${Math.round(skill.relevanceScore * 100)}%)`)
                                .join(', ')}
                            </span>
                          )}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}

        {isThinking && (
          <div className="message message-assistant">
            <div className="message-content">
              <p className="thinking-status">
                Pensando
                <span className="thinking-dot">●</span>
                <span className="thinking-dot">●</span>
                <span className="thinking-dot">●</span>
              </p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe tu mensaje... (Shift+Enter para nueva línea)"
          disabled={isThinking}
        />
        <div className="input-controls">
          <span className="input-hint">Enter para enviar · Shift+Enter para salto</span>
          <button
            onClick={handleSendMessage}
            disabled={isThinking || !inputValue.trim()}
            className="send-btn"
          >
            {isThinking ? 'Procesando...' : 'Enviar'}
          </button>
          {isThinking && (
            <button onClick={handleCancel} className="cancel-btn">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPage;
