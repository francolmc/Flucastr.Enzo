---
name: autonomous-work-manager
description: |
  Orquestador principal para tareas autónomas prolongadas. Gestiona trabajo extendido
  con checkpoints periódicos, sistema de reanudación y reportes de progreso.
  Úsalo para comandos como "trabaja en proyecto X por 2 horas" o tareas largas.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: workflow
  tags: autonomous, prolonged, workflow, management, checkpoints
allowed-tools: recall execute_command read_file write_file web_search calendar
---

# Autonomous Work Manager - Gestor de Trabajo Autónomo

## Pasos a seguir

1. **Análisis inicial**: Interpretar comando y extraer objetivo, duración y tipo de tarea
2. **Planificación**: Crear milestones y estrategia de ejecución
3. **Configuración**: Establecer checkpoints y sistema de monitoreo
4. **Ejecución**: Iniciar trabajo autónomo con reportes periódicos
5. **Manejo de errores**: Reintentar automáticamente o consultar según criticidad
6. **Finalización**: Resumir resultados y guardar estado para futuras referencias

## Formato de salida obligatorio

```
🚀 Iniciando Trabajo Autónomo

📋 Tarea: [descripción clara del objetivo]
⏱️ Duración estimada: [X horas/minutos]
🎯 Tipo: [desarrollo/educativo/investigación/otro]

📊 Plan de ejecución:
   • Milestone 1: [descripción] - [tiempo estimado]
   • Milestone 2: [descripción] - [tiempo estimado]
   • ...

⏰ Checkpoints cada: [30 minutos]

🔄 Estado: INICIANDO...
```

## Formato de checkpoint (cada 30 minutos)

```
⏰ Checkpoint [HH:MM] - [X/Y completado]

✅ Progreso:
   • [tarea completada 1]
   • [tarea completada 2]

⏳ Trabajando en:
   • [tarea actual] - [progreso %]

🚧 Bloqueos/encontrados:
   • [problema 1 y solución]
   • [problema 2 y solución]

📊 Tiempo restante estimado: [X minutos]
```

## Formato de finalización

```
🎉 Trabajo Autónomo Completado

📋 Resumen final:
   • Duración real: [X horas/minutos]
   • Tareas completadas: [X/Y]
   • Eficiencia: [X%]

🏆 Logros principales:
   • [logro 1]
   • [logro 2]
   • ...

📁 Archivos creados/modificados:
   • [archivo 1]
   • [archivo 2]

💡 Próximos pasos sugeridos:
   • [recomendación 1]
   • [recomendación 2]
```

## Reglas

- **Checkpoint obligatorio**: Reportar cada 30 minutos sin falta
- **Manejo de errores**: Reintentar hasta 3 veces automáticamente antes de consultar
- **Estado persistente**: Guardar progreso con `recall` para posibles reanudaciones
- **Priorización**: Enfocarse en milestones críticos primero
- **Calidad sobre velocidad**: No sacrificar calidad por cumplir tiempo

## Tipos de tareas soportadas

### Desarrollo de Software
- Integración con Claude Code/OpenCode
- Iteración basada en historias de usuario
- Revisión y refactorización de código

### Materiales Educativos
- Creación de presentaciones
- Diseño de ejercicios y evaluaciones
- Planificación de clases

### Investigación
- Búsqueda y síntesis de información
- Análisis de documentos
- Creación de informes

## Ejemplos de activación

- "trabaja en el proyecto e-commerce por 3 horas"
- "trabaja en mis clases de programación hasta tener material completo"
- "investiga sobre IA en educación por 2 horas"
- "revisa y mejora el código del dashboard por 1 hora"
- "crea presentación sobre algoritmos para mañana"

## Manejo de Estados

### Estados de tarea
- `INICIANDO`: Preparando entorno y plan
- `EN_PROGRESO`: Ejecutando activamente
- `PAUSADO`: Esperando intervención o recursos
- `BLOQUEADO`: Error requiere atención manual
- `COMPLETADO`: Finalizado con éxito
- `CANCELADO`: Detenido por usuario o error crítico

### Recuperación de estado
```javascript
// Guardar estado
recall("autonomous_work_" + taskId, {
  status: "EN_PROGRESO",
  current_milestone: 2,
  completed_tasks: ["task1", "task2"],
  files_created: ["file1.md", "file2.js"],
  next_checkpoint: new Date(Date.now() + 30*60*1000)
})

// Recuperar estado
const state = recall("autonomous_work_" + taskId)
```

## Integración con otros skills

### Teaching Materials Creator
- Delegar creación de contenido educativo
- Coordinar estructura y calidad

### Code Review Planner
- Solicitar análisis de código
- Integrar sugerencias de mejora

### Claude Code/OpenCode Integration
- Enviar comandos de desarrollo
- Procesar resultados y iterar

## Métricas de éxito

- **Autonomía**: Tiempo trabajando sin intervención
- **Eficiencia**: Tareas completadas vs tiempo estimado
- **Calidad**: Resultados cumplen objetivos
- **Recuperación**: Capacidad de reanudar después de interrupciones
