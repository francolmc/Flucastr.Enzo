# Planner

## El cerebro de Enzo

Planner es el sistema de decisión de Enzo. Su única responsabilidad es responder una pregunta: **¿qué hago ahora?**

## Principio

> El Planner nunca ve el problema completo. Solo ve el siguiente paso.

Esta restricción es intencional. Es la aplicación directa de Amplify al sistema de decisión.

## Qué recibe

En cada iteración, el Planner recibe exactamente cuatro cosas:

1. **El mensaje del usuario** — qué quiere hacer
2. **Lo que sabe del usuario** — hechos de Raíz (nombre, preferencias, proyectos)
3. **Las herramientas disponibles** — qué puede hacer Manos en este momento
4. **El resultado del paso anterior** — qué pasó en la última acción (si hubo una)

Nada más. Sin historial completo de conversación. Sin contexto acumulado de múltiples pasos.

## Qué decide

El Planner responde con exactamente una de tres acciones:

```json
// Usar una herramienta
{"action":"tool","name":"write_file","input":{"path":"...","content":"..."}}

// Responder al usuario
{"action":"response","content":"tu respuesta aquí"}

// Tarea completada
{"action":"done","content":"confirmación en lenguaje natural"}
```

Una sola acción. Nunca dos.

## El loop
Planner decide → tool
↓
Manos ejecuta → resultado
↓
Planner decide → tool o done
↓
... hasta done o MAX_ITERATIONS

## Lo que el Planner NO hace

- No clasifica la complejidad de la tarea (SIMPLE/MODERATE/COMPLEX)
- No descompone la tarea en pasos antes de empezar
- No tiene reglas específicas para tipos de archivos o herramientas
- No hardcodea nombres de herramientas
- No decide cuándo terminar basándose en reglas — el modelo decide

## Por qué no hay Classifier ni Decomposer

En versiones anteriores de Enzo existían un Classifier (que decidía SIMPLE/MODERATE/COMPLEX) y un Decomposer (que dividía tareas en subtareas). Ambos fueron eliminados en Amplify v2.

**El problema del Classifier:** clasificar requiere entender la intención completa del usuario — exactamente lo que un modelo pequeño hace mal con contexto complejo.

**El problema del Decomposer:** descomponer una tarea antes de ejecutarla requiere ver el problema completo — lo opuesto al principio de Amplify.

**La solución:** dejar que el modelo decida paso a paso. No necesita ver el problema completo si solo tiene que decidir el siguiente paso.

## Temperatura

El Planner usa temperatura 0.2 — baja pero no cero. Suficiente determinismo para seguir el formato JSON, suficiente flexibilidad para razonar sobre situaciones nuevas.

## Modelo mínimo validado

- `qwen3:4b-instruct` — funciona para la mayoría de los casos
- `qwen2.5:7b` — mejor seguimiento de instrucciones JSON
- `qwen3:8b` — recomendado para tareas complejas con múltiples pasos

## Estado actual

- ✅ Implementado en `packages/core/src/planner/planner.ts`
- ✅ Validado con qwen3:4b-instruct en CLI
- 🔄 Loop infinito pendiente de resolver — el modelo no siempre emite `done` tras completar
- 🔄 Telegram pendiente — JSON crudo llegando al usuario en algunos casos

## Problema conocido y enfoque

El modelo a veces no emite `done` después de completar una tarea — repite la misma acción hasta MAX_ITERATIONS. La causa: el resultado del paso anterior en el contexto incluye el JSON de la acción, y el modelo lo interpreta como instrucción pendiente.

**Enfoque correcto:** el resultado que recibe el Planner debe ser solo el output de la herramienta — nunca el JSON de la acción que lo generó.

## Decisiones de diseño

**¿Por qué JSON en lugar de lenguaje natural?**
Los modelos pequeños son más consistentes con formatos estructurados que con interpretación de lenguaje natural para decidir acciones. El JSON es el contrato mínimo que necesita el Planner para funcionar.

**¿Por qué no usar function calling nativo?**
Algunos modelos locales no soportan function calling nativo. El JSON en texto es universal — funciona con cualquier modelo que pueda seguir instrucciones.