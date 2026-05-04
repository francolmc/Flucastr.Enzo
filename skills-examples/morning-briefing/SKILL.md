---
name: morning-briefing
description: |
  Genera un resumen matutino completo con emails importantes sin leer, eventos del calendario del día,
  tareas pendientes de ayer y las top 3 prioridades para hoy. Úsalo cuando el usuario diga
  "buenos días", "dame el briefing", "qué tengo hoy" o solicite un resumen de la mañana.
version: "2.0.0"
license: MIT
metadata:
  author: enzo-org
  category: productivity
  tags: morning, daily-routine, briefing, tasks, calendar
allowed-tools: email_unread_count calendar list_directory read_file recall
---

# Morning Briefing - Resumen Matutino

## Pasos a seguir

1. **Emails**: Usar `email_unread_count` para obtener cantidad de emails sin leer
2. **Calendario**: Usar `calendar` con acción "list" para eventos de hoy
3. **Pendientes**: Usar `recall` con key="tasks" para recuperar pendientes de "ayer"
4. **Prioridades**: Seleccionar top 3 basándote en urgencia e importancia

## Formato de salida obligatorio

```
☀️ Buenos días [nombre del usuario]

� Emails: [X sin leer, resumen breve de importantes]
📅 Hoy: [lista de eventos con horarios]
✅ Pendientes de ayer: [máximo 3 tareas]
🎯 Top 3 hoy:
   1. [primera prioridad]
   2. [segunda prioridad]
   3. [tercera prioridad]
💡 Sugerencia: [una acción concreta para empezar]
```

## Reglas

- Máximo 3 pendientes de ayer (las más importantes)
- Las 3 prioridades deben ser accionables hoy
- La sugerencia debe ser específica, no genérica como "trabaja duro"
- Si no hay emails importantes, indicar "Sin emails urgentes"
- Si no hay eventos hoy, indicar "Calendario libre"

## Ejemplos de activación

- "buenos días, qué tengo hoy"
- "dame el briefing matutino"
- "cómo arranco el día"
- "qué tengo pendiente para hoy"
- "resumen de la mañana"