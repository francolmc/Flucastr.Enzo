# Planner

## El cerebro de Enzo

Planner es el sistema de decisión de Enzo. Su única responsabilidad es responder una pregunta: **¿qué hago ahora?**

## Principio

> El Planner nunca ve el problema completo. Solo ve el siguiente paso.

Esta restricción es intencional. Es la aplicación directa de Amplify al sistema de decisión.

## Las 5 fases (Polya)

El Planner implementa el método de George Pólya para resolución de problemas:

**Fase 1 — Entender**
El modelo describe en una oración qué quiere lograr el usuario, con las tools disponibles como contexto.

**Fase 2 — Planificar**
El modelo genera los pasos necesarios para completar el objetivo. Cada paso usa exactamente una tool.

**Fase 3 — Ejecutar**
El modelo extrae los parámetros del paso actual y llama a la tool correspondiente via MCP.

**Fase 4 — Evaluar**
Después de cada paso, el modelo verifica si el objetivo ya está cumplido. Si sí, termina el loop.

**Fase 5 — Responder**
El modelo genera una respuesta en lenguaje natural confirmando al usuario qué se hizo.

## Qué recibe

En cada fase, el Planner recibe exactamente cuatro cosas:

1. **El mensaje del usuario** — qué quiere hacer
2. **Lo que sabe del usuario** — hechos de Raíz (nombre, preferencias, proyectos)
3. **Las herramientas disponibles** — qué puede hacer Manos en este momento
4. **El resultado del paso anterior** — qué pasó en la última acción (si hubo una)

Nada más. Sin historial completo de conversación. Sin contexto acumulado de múltiples pasos.

## Por qué lenguaje natural en lugar de JSON

Los modelos pequeños open-weight degradan hasta 27 puntos cuando se les pide interpretar JSON estructurado en texto (investigación NLT). En cambio, cuando se les pide razonar en lenguaje natural y outputear en texto plano, mantienen su capacidad de razonamiento.

El Planner usa este principio: el modelo razona en lenguaje natural, no en JSON. Esto no es un hack — es el fundamento teórico del diseño.

## Lo que el Planner NO hace

- No clasifica la complejidad de la tarea (SIMPLE/MODERATE/COMPLEX)
- No descompone la tarea en pasos antes de empezar — lo hace fase por fase
- No tiene reglas específicas para tipos de archivos o herramientas
- No hardcodea nombres de herramientas
- No decide cuándo terminar basándose en reglas — el modelo decide en fase 4

## Temperatura

El Planner usa temperatura 0 para las fases de análisis y planificación — determinismo para seguir el formato de salida. Temperatura 0.3 para la fase de respuesta — flexibilidad para expresarse naturalmente.

## Modelo mínimo validado

- `qwen3:4b-instruct` — funciona para la mayoría de los casos
- `qwen2.5:7b` — mejor seguimiento de instrucciones en español
- `qwen3:8b` — recomendado para tareas complejas con múltiples pasos

## Estado actual

- ✅ Implementado en `packages/core/src/planner/planner.ts`
- ✅ 5 fases de Polya implementadas
- ✅ Evaluación interativa en fase 4 (isObjectiveComplete)
- ✅ Validado con qwen3:4b-instruct en CLI
- ✅ Usa NLT — sin JSON estructurado en prompts
- 🔄 Telegram pendiente — respuestas crudas llegando en algunos casos