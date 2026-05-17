# Raíz

## La memoria de Enzo

Raíz es el sistema de memoria de Enzo. Su responsabilidad es **persistir todo lo que Enzo necesita recordar entre conversaciones**.

## Principio

> Sin Raíz, Enzo nace de cero en cada conversación. Con Raíz, Enzo crece con el uso.

Raíz no es solo una base de datos — es la identidad acumulada del asistente. Cuanto más se usa Enzo, más rico es el contexto que Raíz provee al Planner.

## Qué almacena

**1. Hechos del usuario (facts)**
Información concreta y durable sobre la persona:
- Nombre, ciudad, profesión, empresa
- Proyectos activos
- Preferencias y rutinas
- Cualquier dato que el usuario menciona y vale la pena recordar

**2. Herramientas disponibles (tools)**
El catálogo de lo que Manos puede hacer:
- Nombre de la herramienta
- Descripción en lenguaje natural
- Schema de parámetros

**3. Servidores MCP (mcps)**
Cómo conectarse a cada servidor:
- Nombre del servidor
- Comando de inicio
- Tools que expone

**4. Skills aprendidos (Ritos)**
Workflows que Enzo construyó desde la experiencia:
- Situación que lo activa
- Pasos que lo resuelven
- Cuántas veces fue útil

## Estructura SQLite

```sql
-- Hechos del usuario
CREATE TABLE facts (
  userId TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, key)
);

-- Herramientas disponibles
CREATE TABLE tools (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  inputSchema TEXT NOT NULL,
  mcpServer TEXT NOT NULL  -- qué servidor MCP la expone
);

-- Servidores MCP
CREATE TABLE mcps (
  name TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  args TEXT NOT NULL,      -- JSON array
  enabled INTEGER DEFAULT 1
);

-- Skills aprendidos (Ritos) — futuro
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,   -- situación que lo activa
  steps TEXT NOT NULL,     -- JSON array de pasos
  usageCount INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL
);
```

## Cómo fluye la información
Conversación
↓
Raíz provee al Planner:

facts del usuario → contexto personal
tools disponibles → qué puede hacer Manos

Manos consulta Raíz:

¿qué MCP tiene esta tool?
¿cómo me conecto a ese MCP?

Después de la conversación:

nuevos facts detectados → se guardan en Raíz
nuevo Rito aprendido → se guarda en Raíz


## Principios de diseño

**Upsert, nunca duplicados**
Si un fact ya existe, se actualiza. Nunca se duplica. La clave es `(userId, key)` — un solo valor por concepto por usuario.

**Keys canónicas en inglés**
Los facts usan keys normalizadas: `name`, `city`, `profession`, `employer`, `projects`. Nunca `nombre`, `ciudad`, `mi_nombre`. Consistencia sobre flexibilidad.

**Local y privado**
Raíz vive en SQLite en la máquina del usuario — `/Users/franco/enzo.db` por defecto. Nunca se envía a servidores externos. El usuario tiene control total.

**Simple sobre complejo**
Raíz no tiene embeddings, no tiene búsqueda semántica, no tiene vectores. Solo SQL simple y rápido. La complejidad viene cuando el volumen lo justifica — no antes.

## Lo que Raíz NO hace

- No decide qué recordar — eso lo decide el modelo
- No tiene TTL automático — los facts persisten hasta que el usuario los elimina
- No sincroniza entre dispositivos — es local
- No encripta — el usuario es responsable de la seguridad de su máquina

## Estado actual

- ✅ Implementado en `packages/core/src/memory/memory.ts`
- ✅ Tablas `facts` y `tools` funcionando
- 🔄 Tabla `mcps` pendiente — MCPs hardcodeados en Manos
- 🔄 Tabla `skills` pendiente — Ritos no implementados aún
- 🔄 Extracción automática de facts pendiente — hoy se guardan manualmente

## El nombre

Raíz — porque es lo que da estabilidad y nutrición al árbol. Sin raíces, el árbol cae con el primer viento. Con raíces profundas, crece sin límite.

Enzo sin Raíz es un chatbot. Enzo con Raíz es un asistente que te conoce.