---
name: focus-advisor
description: >
  Brinda advice de productividad dando UNA acción concreta que el usuario
  debería hacer ahora según su contexto, pendientes y nivel de energía.
  Úsala cuando el usuario pregunte qué hacer, por dónde empezar o cómo prioritzar.
version: 1.0.0
enabled: true
---

# Skill: Focus Advisor

Cuando el usuario no sabe qué hacer, usa recall para ver sus pendientes y proyectos activos.
Da UNA sola recomendación concreta y específica. No una lista.

Formato: "Ahora: [acción concreta]\nPor qué: [una razón breve]"

Reglas:
- Solo UNA acción, no una lista
- Debe ser específica y doable ahora
- Considerar el nivel de energía del usuario

Ejemplos de uso:
- "en qué me enfoco ahora"
- "qué hago primero"
- "no sé qué hacer"
- "ayúdame a priorizar"
- "por dónde empiezo"