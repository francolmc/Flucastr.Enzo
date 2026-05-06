# @enzo/sdk

SDK oficial para interactuar con la API REST de Enzo. Proporciona un cliente tipado en TypeScript para todas las operaciones de chat, comandos, memoria y voz.

## Instalación

```bash
pnpm add @enzo/sdk
```

## Uso básico

```typescript
import { EnzoApiClient } from '@enzo/sdk';

const client = new EnzoApiClient({
  apiUrl: 'http://localhost:3001',
  apiKey: 'optional-api-key', // opcional
});

// Enviar un mensaje
const response = await client.chat.send('Hola Enzo', {
  userId: 'user-123',
  conversationId: 'conv-456',
  source: 'telegram',
});

console.log(response.content); // Respuesta del modelo
```

## Configuración

### Variables de entorno

```bash
ENZO_API_URL=http://localhost:3001  # URL base de la API
ENZO_API_KEY=your-api-key           # Opcional: para autenticación
```

### Opciones del cliente

```typescript
interface EnzoApiClientOptions {
  apiUrl: string;      // URL base de la API (requerido)
  apiKey?: string;     // API key para autenticación (opcional)
  timeoutMs?: number;  // Timeout en ms (default: 30000)
}
```

## API

### Chat

#### `chat.send(message, options)`

Envía un mensaje al modelo y obtiene la respuesta completa.

```typescript
const result = await client.chat.send('¿Qué hora es?', {
  userId: 'user-123',
  conversationId: 'conv-456',
  source: 'telegram', // 'telegram' | 'web' | 'cli' | 'api'
  agentId: 'agent-789', // opcional
  userLanguage: 'es',   // opcional
});

// Resultado:
{
  content: 'Son las 3:45 PM...',
  conversationId: 'conv-456',
  requestId: 'req-abc',
  complexityUsed: 'SIMPLE',
  providerUsed: 'ollama',
  modelUsed: 'qwen2.5:7b',
  durationMs: 1250,
  usage: {
    inputTokens: 45,
    outputTokens: 120,
  }
}
```

#### `chat.sendStream(message, options, onEvent)`

Envía un mensaje y recibe la respuesta en streaming (Server-Sent Events).

```typescript
await client.chat.sendStream(
  'Cuéntame un cuento largo',
  { userId: 'user-123', source: 'web' },
  (event) => {
    if (event.type === 'chunk') {
      process.stdout.write(event.data.content);
    }
    if (event.type === 'done') {
      console.log('\n[Completo]');
    }
  }
);
```

#### `chat.classify(message, options)`

Clasifica un mensaje para determinar complejidad y ruta de procesamiento.

```typescript
const classification = await client.chat.classify('Hola', {
  userId: 'user-123',
  conversationId: 'conv-456',
  source: 'telegram',
});

// Resultado:
{
  level: 'SIMPLE', // 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'AGENT'
  reason: 'El mensaje es una saludo simple...',
  suggestedTool: undefined,
  prefersHostTools: false,
}
```

#### `chat.getHistory(conversationId)`

Obtiene el historial de una conversación.

```typescript
const history = await client.chat.getHistory('conv-456');
// { messages: [...] }
```

#### `chat.getConversations(userId)`

Lista todas las conversaciones de un usuario.

```typescript
const conversations = await client.chat.getConversations('user-123');
// { conversations: [{ id, title, updatedAt }] }
```

### Comandos

#### `commands.execute(name, args, userId)`

Ejecuta un comando pre-registrado en el sistema.

```typescript
const result = await client.commands.execute('chat.new', [], 'user-123');
// { success: true, message: 'Nueva conversación iniciada', data: {...} }

const result = await client.commands.execute('agent.set', ['nombre-agente'], 'user-123');
// { success: true, message: 'Agente configurado', data: { agentId, agentName } }
```

**Comandos disponibles:**

| Comando | Args | Descripción |
|---------|------|-------------|
| `chat.new` | - | Nueva conversación |
| `chat.clear` | - | Limpiar historial |
| `agent.list` | - | Listar agentes disponibles |
| `agent.set` | `[nombre]` | Configurar agente activo |
| `memory.list` | - | Listar memorias del usuario |
| `system.update` | - | Actualizar sistema |

### Memoria

#### `memory.remember(userId, key, value)`

Guarda un dato en la memoria del usuario.

```typescript
await client.memory.remember('user-123', 'color_favorito', 'azul');
```

#### `memory.recall(userId, key?)`

Recupera datos de la memoria.

```typescript
// Recuperar una clave específica
const value = await client.memory.recall('user-123', 'color_favorito');

// Recuperar todas las memorias
const all = await client.memory.recall('user-123');
// [{ key, value, createdAt, updatedAt }]
```

### Voz

#### `voice.transcribe(audioBuffer, mimeType)`

Transcribe audio a texto.

```typescript
const result = await client.voice.transcribe(audioBuffer, 'audio/ogg');
// { success: true, text: 'Hola Enzo', language: 'es', durationSeconds: 2.5 }
```

#### `voice.synthesize(text, language)`

Convierte texto a voz (TTS).

```typescript
const result = await client.voice.synthesize('Hola mundo', 'es');
// { success: true, audioBuffer: Buffer, mimeType: 'audio/ogg' }
```

### Archivos

#### `files.upload(buffer, filename, mimeType)`

Sube un archivo al servidor.

```typescript
const result = await client.files.upload(buffer, 'documento.pdf', 'application/pdf');
// { success: true, fileId: '...', url: '/uploads/...' }
```

## Manejo de errores

```typescript
try {
  const result = await client.chat.send('Hola', { userId: 'user-123' });
} catch (error) {
  if (error instanceof EnzoApiError) {
    console.log(error.statusCode); // 400, 401, 500, etc.
    console.log(error.message);
  }
}
```

## Arquitectura

```
┌─────────────┐      HTTP/REST      ┌─────────────┐
│  Tu Cliente │ ◄──────────────────► │  API Enzo   │
│  @enzo/sdk  │   EnzoApiClient      │   (Server)  │
└─────────────┘                      └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │  @enzo/core │
                                    │  (LLM/Orch) │
                                    └─────────────┘
```

El SDK es solo un cliente HTTP tipado. Toda la lógica de negocio (orquestador, memoria, modelos) vive en el servidor API que usa `@enzo/core`.

## Licencia

MIT
