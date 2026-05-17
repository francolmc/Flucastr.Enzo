# Amplify

## El principio que hace único a Enzo

Amplify es el sistema central de Enzo. No es un componente de código — es una filosofía de diseño que guía cada decisión arquitectónica del proyecto.

## El problema que resuelve

Los modelos de lenguaje pequeños (4B-8B parámetros) tienen capacidad de razonamiento limitada cuando se les da un problema complejo. Fallan no por falta de inteligencia, sino por sobrecarga de contexto — demasiada información, demasiadas decisiones, demasiados pasos simultáneos.

Los asistentes comerciales resuelven esto con modelos grandes y costosos. Enzo resuelve esto de forma diferente.

## El principio

> Un modelo pequeño que solo ve el siguiente paso rinde mejor que un modelo grande que ve el problema completo.

Esto no es una limitación — es una ventaja de diseño. Amplify divide cualquier tarea en pasos atómicos donde cada paso es tan simple que cualquier modelo puede resolverlo bien.

## Cómo funciona
Tarea compleja
↓
Planner — ¿cuál es el siguiente paso?
↓
Manos — ejecuta ese paso
↓
Resultado → Planner — ¿qué sigue?
↓
... hasta completar la tarea

El modelo nunca ve el problema completo. Solo ve:
- Quién es el usuario (Raíz)
- Qué herramientas tiene disponibles (Manos)
- El resultado del paso anterior
- El mensaje actual del usuario

Nada más.

## Por qué esto es diferente

| Sistema | Enfoque | Modelo mínimo |
|---------|---------|---------------|
| OpenClaw | Gateway multi-canal, modelos grandes | Claude, GPT-4 |
| Hermes | Auto-mejora, memoria por capas | Modelos capaces |
| Enzo / Amplify | Contexto mínimo, pasos atómicos | qwen3:4b-instruct |

Enzo es el único sistema diseñado desde el principio para modelos pequeños. No como limitación — como diferencial.

## Lo que Amplify NO es

- No es el loop de código (eso es el Planner)
- No es la memoria (eso es Raíz)
- No es la ejecución (eso es Manos)

Amplify es el principio que conecta todo. Cada decisión de diseño en Enzo se evalúa con una pregunta: ¿esto reduce la carga cognitiva del modelo o la aumenta?

Si la aumenta, no va.

## El nombre

Amplify — amplificar. Un modelo pequeño con el contexto correcto no es un modelo pequeño. Es un modelo amplificado.

Como el desierto de Atacama: aparentemente inhóspito, pero cuando tiene las condiciones correctas florece con una intensidad que ningún otro ecosistema puede igualar.

## Principios derivados

**1. El modelo decide, el código ejecuta**
Ninguna lógica del código toma decisiones sobre qué hacer. Solo el modelo decide. El código ejecuta y observa.

**2. Contexto mínimo por paso**
Cada llamada al modelo recibe exactamente lo que necesita para ese paso. Nada más. El historial completo nunca entra al loop.

**3. Un paso a la vez**
Nunca se le pide al modelo que resuelva múltiples pasos simultáneamente. Divide y vencerás — siempre.

**4. Las herramientas son dinámicas**
El modelo no conoce herramientas hardcodeadas. Conoce las herramientas disponibles en este momento para este usuario. Si cambian, el modelo se adapta.

**5. El modelo aprende del uso**
Cada interacción puede convertirse en un Rito — un skill reutilizable. El modelo no solo ejecuta, acumula capacidad.

## Estado actual

- ✅ Principio validado — el Planner con contexto mínimo funciona con qwen3:4b-instruct
- ✅ Manos implementado — ejecuta tools via MCP
- ✅ Raíz implementado — SQLite con facts y tools
- 🔄 MCPs dinámicos — pendiente (Semana 1)
- 🔄 Ritos — pendiente (Semana 2)
- 🔄 Echo — pendiente (Semana 3)