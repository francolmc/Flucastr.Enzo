---
name: evening-recap
description: |
  Genera un resumen de cierre de día con lo que se logró, pendientes para mañana,
  revisión del calendario del día siguiente y estado de inversiones/portafolio si aplica.
  Úsalo cuando el usuario diga "resumen del día", "qué hice hoy", "cierre del día",
  "recap nocturno" o solicite un resumen final de la jornada.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: productivity
  tags: evening, recap, daily-review, planning, routine
allowed-tools: recall calendar read_file
---

# Resumen de Cierre de Día - Evening Recap

## Pasos a seguir

1. **Logros**: Usar `recall` con key="tasks" o "logros" para recuperar lo completado "hoy"
2. **Pendientes**: Usar `recall` para tareas que quedaron pendientes
3. **Mañana**: Usar `calendar` para eventos del día siguiente
4. **Inversiones** (opcional): Si el usuario menciona portafolio o inversiones, buscar archivos relevantes

## Formato de salida obligatorio

```
🌙 Resumen del Día

🏆 Logros de hoy (máx 5):
   • [logro 1]
   • [logro 2]
   • ...

📋 Pendientes para mañana:
   • [pendiente 1] - [prioridad]
   • [pendiente 2] - [prioridad]
   • ...

📅 Mañana en el calendario:
   • [hora] - [evento 1]
   • [hora] - [evento 2]
   • ... (o "Sin eventos" si aplica)

📈 Inversiones/Portafolio:
   [Solo si el usuario lo solicita explícitamente o hay datos recientes]

🎯 Prioridad #1 para mañana: [la tarea más importante]

💤 Descansa bien. ¿Necesitas preparar algo para mañana?
```

## Reglas

- Máximo 5 logros (los más importantes)
- Prioridad #1 debe ser la tarea de mayor impacto para mañana
- Inversiones: solo incluir si hay datos disponibles o el usuario lo pide
- Mantener tono positivo pero realista
- Sugerir preparar material la noche anterior si hay eventos importantes mañana
- No listar más de 7 pendientes (sugiere priorizar si hay más)

## Ejemplos de activación

- "resumen del día"
- "qué hice hoy"
- "cierre del día"
- "recap nocturno"
- "resumen antes de dormir"
- "planificación para mañana"

## Opcional: Comando "inversiones"

Si el usuario específicamente pregunta por inversiones:
- Buscar archivos con nombres como "portfolio", "inversiones", "stocks", "crypto"
- Usar `read_file` si encuentras archivos relevantes
- Presentar resumen breve del estado
