---
name: midday-checkin
description: |
  Realiza un check-in de medio día revisando qué tareas de la mañana se completaron,
  cuáles quedan pendientes y el estado de las tareas delegadas a la IA.
  Úsalo cuando el usuario diga "check del mediodía", "cómo vamos", "revisión del día",
  "qué hice esta mañana" o solicite un seguimiento del progreso.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: productivity
  tags: midday, checkin, progress, tasks, routine
allowed-tools: recall calendar read_file
---

# Check-in de Mediodía

## Pasos a seguir

1. **Completadas**: Usar `recall` con key="tasks" para recuperar tareas de "esta mañana" o "hoy"
2. **Calendario**: Usar `calendar` para ver eventos ya pasados hoy (completed)
3. **Pendientes**: Identificar qué queda pendiente de la mañana
4. **IA Tasks**: Buscar en memoria tareas delegadas a IA y su estado

## Formato de salida obligatorio

```
🕐 Check-in Mediodía

✅ Completadas esta mañana:
   • [tarea 1]
   • [tarea 2]
   • ...

⏳ Pendientes para la tarde:
   • [tarea pendiente 1] - [prioridad]
   • [tarea pendiente 2] - [prioridad]

🤖 Estado de tareas de IA:
   • [tarea delegada]: [en progreso / completada / esperando]
   • ...

📊 Productividad: [X% completado]

📌 Recomendación para la tarde:
[Una sugerencia específica basada en pendientes]
```

## Reglas

- Sé honesto sobre el progreso, no inflar números
- Si no hay datos de "mañana", buscar "hoy" en general
- Prioriza tareas que solo el usuario puede hacer
- Sugiere delegar a IA las tareas repetitivas
- La recomendación debe ser accionable inmediatamente

## Ejemplos de activación

- "check del mediodía"
- "cómo vamos hoy"
- "qué hice esta mañana"
- "revisión del día"
- "actualización del medio día"
