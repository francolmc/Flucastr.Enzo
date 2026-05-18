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

- Los MCPs se configuran en `~/.enzo/config.json`
- El registry descubre las tools de cada MCP al inicio via `listTools()`
- Las tools descubiertas se guardan en Raíz con su descripción y schema
- El Planner lee las tools desde Raíz para decidir qué usar

Esto significa que agregar un MCP nuevo es solo agregarlo al config.json — sin tocar código.

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
- ✅ Registry de MCPs en `packages/core/src/mcp/registry.ts`
- ✅ Descubrimiento automático de tools desde config.json
- ✅ Devuelve resultados y errores al Planner
- 🔄 Conexiones persistentes pendientes — hoy crea una conexión nueva por cada llamada
- 🔄 DuckDuckGo MCP pendiente — búsqueda web no disponible aún

## El nombre

Manos — porque hace. No piensa, no decide, no evalúa. Toma lo que el Planner le da y lo convierte en acción real en el mundo.