# Manos

## El ejecutor de Enzo

Manos es el sistema de ejecución de Enzo. Su única responsabilidad es: **hacer realidad lo que el Planner decide**.

## Principio

> Manos no decide nada. Solo ejecuta.

El Planner elige la herramienta y los parámetros. Manos la llama, espera el resultado, y lo devuelve. Sin lógica de decisión, sin compensación, sin fallbacks complejos.

## Qué recibe

- Nombre de la herramienta
- Parámetros de entrada

## Qué devuelve

- Resultado exitoso como texto
- Error como texto — el Planner decide qué hacer con él

## Arquitectura

Manos tiene dos capas:

**1. Registry de tools**
Qué herramientas existen, qué hacen, qué parámetros aceptan. Vive en Raíz (SQLite). El Planner lee esta información para decidir qué tool usar.

**2. Registry de MCPs**
Qué servidor MCP tiene cada herramienta. Cuando Manos recibe `write_file`, sabe que pertenece al servidor `filesystem` y cómo conectarse a él.
Planner → "usa write_file con {path, content}"
↓
Manos busca: ¿qué MCP tiene write_file? → filesystem
↓
Manos conecta al MCP filesystem
↓
Manos llama write_file con los parámetros
↓
Manos devuelve el resultado al Planner

## Diseño dinámico — el principio clave

Manos no hardcodea ningún MCP ni ninguna herramienta. Todo es dinámico:

- Las tools se registran en Raíz con su descripción y schema
- Los MCPs se registran en Raíz con su comando de inicio y las tools que exponen
- Manos descubre en tiempo de ejecución qué servidor tiene cada tool

Esto significa que agregar un MCP nuevo es solo registrarlo — sin tocar código.
Raíz (SQLite):
tools:
write_file → mcp: filesystem
search     → mcp: duckduckgo
calendar   → mcp: google-calendar
mcps:
filesystem  → { command: "npx", args: [...] }
duckduckgo  → { command: "uvx", args: [...] }
google-calendar → { command: "npx", args: [...] }

## Conexión a MCPs

Hoy Manos crea una nueva conexión MCP por cada llamada a una herramienta. Esto es correcto para empezar — simple y sin estado compartido.

En el futuro: conexiones persistentes por servidor — conectar una sola vez al inicio y reusar. Esto reduce latencia y el ruido de `Secure MCP Filesystem Server running on stdio` en cada llamada.

## Manejo de errores

Si una tool falla, Manos devuelve el error como texto. El Planner recibe ese texto como resultado y decide qué hacer — intentar diferente, pedir ayuda al usuario, o abandonar.

Manos nunca reintenta automáticamente. El Planner decide si reintentar.

## Lo que Manos NO hace

- No decide qué tool usar
- No valida si los parámetros tienen sentido
- No reintenta automáticamente
- No tiene lógica específica para tipos de archivos
- No asume nada sobre el contenido de los parámetros

## Estado actual

- ✅ Implementado en `packages/core/src/executor/executor.ts`
- ✅ Conecta a MCP filesystem via stdio
- ✅ Devuelve resultados y errores al Planner
- 🔄 MCPs dinámicos pendientes — hoy el MCP filesystem está hardcodeado
- 🔄 Conexiones persistentes pendientes — hoy crea una conexión nueva por cada llamada
- 🔄 DuckDuckGo MCP pendiente — búsqueda web no disponible aún

## Problema conocido

El MCP filesystem está hardcodeado en el executor. Esto viola el principio de Amplify — las herramientas deben ser dinámicas. El fix es leer la configuración de MCPs desde Raíz en lugar de hardcodear el servidor.

## Nombre

Manos — porque hace. No piensa, no decide, no evalúa. Toma lo que el Planner le da y lo convierte en acción real en el mundo.