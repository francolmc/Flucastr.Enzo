# @enzo/telegram

Bot de Telegram para Enzo que se comunica **exclusivamente vía SDK** con la API REST.

> ⚠️ **Modo SDK**: Este paquete ya no accede directamente a `@enzo/core`. Toda la comunicación con el orquestador, memoria y modelos pasa por la API usando `@enzo/sdk`.

## Arquitectura

```
┌─────────────────┐      HTTP/REST      ┌─────────────────┐      LLM/Orch
│   Telegram Bot  │ ◄──────────────────► │   API Server    │ ◄──────────────►
│   (@enzo/sdk)   │   EnzoApiClient      │   (@enzo/core)  │   Models/Memory
│                 │                      │                 │
│  - Recibe msgs  │                      │  - Clasifica    │
│  - Envía cmds   │                      │  - Procesa      │
│  - Muestra resp │                      │  - Extrae mem   │
└─────────────────┘                      └─────────────────┘
```

## Configuración

### Variables de entorno requeridas

```bash
# Token del bot de Telegram (obligatorio)
TELEGRAM_BOT_TOKEN=your-bot-token

# URL de la API de Enzo (obligatorio para modo SDK)
ENZO_API_URL=http://localhost:3001

# Usuarios permitidos (opcional)
TELEGRAM_ALLOWED_USERS=123456789,987654321

# ID del owner para compartir agentes (opcional)
TELEGRAM_AGENT_OWNER_USER_ID=123456789
```

### Sin ENZO_API_URL

Si `ENZO_API_URL` no está configurado, el bot fallará al iniciar con:

```
Error: ENZO_API_URL environment variable is not set.
```

Esto es intencional: **Telegram requiere el API para funcionar**.

## Comandos disponibles

| Comando | SDK Method usado | Descripción |
|---------|------------------|-------------|
| `/start` | - | Mensaje de bienvenida |
| `/help` | - | Lista de comandos |
| `/new` | `commands.execute('chat.new')` | Nueva conversación |
| `/clear` | `commands.execute('chat.clear')` | Limpiar historial |
| `/memory` | `memory.recall()` | Ver memorias guardadas |
| `/agent` | `commands.execute('agent.list/set')` | Gestionar agentes |

## Mensajes

Cuando envías un mensaje de texto:

1. **Clasificación**: `ctx.apiClient.chat.classify()`
2. **Procesamiento**: `ctx.apiClient.chat.send()`
3. **Respuesta**: Se muestra en Telegram

Todo pasa por la API. No hay acceso directo al `Orchestrator` ni `MemoryService`.

## Desarrollo

### Iniciar en modo desarrollo

```bash
# Terminal 1: API server (requerido)
cd packages/api
pnpm dev

# Terminal 2: Telegram bot
cd packages/telegram
pnpm dev
```

### Build

```bash
cd packages/telegram
pnpm build
```

### Estructura del código

```
src/
├── index.ts           # Entry point, inicializa apiClient
├── bot.ts             # Configuración del bot Telegraf
├── apiClient.ts       # Wrapper para @enzo/sdk
├── handlers/
│   ├── message.ts     # Handler de mensajes (usa apiClient)
│   └── commands.ts    # Comandos (usa apiClient)
└── ...
```

## Migración desde acceso directo al core

### Antes (acceso directo)

```typescript
// ❌ Ya no funciona
const result = await ctx.orchestrator.process({
  message: 'Hola',
  userId: '123',
});

const memories = await ctx.memoryService.recall('123');
```

### Ahora (vía SDK)

```typescript
// ✅ Forma correcta
const result = await ctx.apiClient!.chat.send('Hola', {
  userId: '123',
  source: 'telegram',
});

const memories = await ctx.apiClient!.memory.recall('123');
```

## Features desactivadas en modo SDK

| Feature | Estado | Razón |
|---------|--------|-------|
| LanguageMiddleware | ⚠️ Simplificado | Requiere provider LLM local |
| Memory extraction | ✅ En API | El servidor extrae memorias |
| Echo Engine | ❌ Desactivado | Requiere acceso directo a orchestrator |
| TTS local | ⚠️ Parcial | Si hay `ttsService` configurado, se usa |

## Troubleshooting

### "API client not configured"

Asegúrate de tener `ENZO_API_URL` configurado:

```bash
export ENZO_API_URL=http://localhost:3001
```

### "Connection refused"

La API no está corriendo. Inicia el servidor API primero:

```bash
cd packages/api && pnpm dev
```

### Errores de timeout

Aumenta el timeout en el cliente (opcional):

```typescript
// En apiClient.ts
new EnzoApiClient({
  apiUrl: process.env.ENZO_API_URL!,
  timeoutMs: 60000, // 60 segundos
});
```

## API de Enzo

Para más detalles sobre los métodos disponibles en el SDK, ver [`@enzo/sdk`](../sdk/README.md).

## Licencia

MIT
