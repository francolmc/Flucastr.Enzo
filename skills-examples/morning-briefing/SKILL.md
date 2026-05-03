---
name: morning-briefing
description: >
  Genera un resumen matutino diario con pendientes, proyectos activos
  y agenda del usuario. Úsala cuando el usuario pida el briefing,
  resumen del día o cómo empezar la jornada.
version: 1.0.0
enabled: true
---

# Skill: Morning Briefing

Usa recall para recuperar pendientes y proyectos activos.

Formato:
```
Buenos días [nombre] ☀️
📋 Pendientes: [top 3]
🚀 En progreso: [proyectos activos]
💡 Sugerencia: [UNA acción concreta]
```

Reglas:
- Máximo 3 pendientes destacados
- Incluir solo proyectos con actividad reciente
- Dar UNA sugerencia Actionable concreta

Ejemplos de uso:
- "buenos días, qué tengo hoy"
- "dame el briefing matutino"
- "cómo arranco el día"
- "qué tengo pendiente para hoy"