---
name: activities-reminders-manager
description: |
  Gestiona agenda, calendario, actividades, recordatorios y eventos de Enzo. Crea,
  modifica, elimina y consulta eventos programados. Programar reuniones, daily meetings,
  recordatorios y tareas en la agenda. Usa "agenda", "calendario", "programar", "agregar
  a agenda", "reunión", "daily", "recordatorio" para activar.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: productivity
  tags: agenda, calendario, programar, eventos, reuniones, daily meetings, recordatorios, schedule, calendar
allowed-tools: calendar recall write_file read_file
---

# Activities & Reminders Manager - Gestor de Actividades y Recordatorios

## Pasos a seguir

1. **Interpretar solicitud**: Analizar si es crear, modificar, eliminar o consultar
2. **Validar información**: Verificar fechas, horas y descripciones
3. **Gestionar calendario**: Usar tool `calendar` para eventos del sistema
4. **Almacenar en memoria**: Usar `recall` para persistencia de recordatorios
5. **Confirmar operación**: Mostrar resumen y próximos pasos
6. **Recordatorio activo**: Configurar notificaciones si aplica

## Formato de salida obligatorio

```
📅 Gestión de Actividades y Recordatorios

🎯 Acción: [crear/modificar/eliminar/consultar]
📋 Tipo: [evento/recordatorio/tarea]

📝 Detalles:
   • Título: [descripción]
   • Fecha: [DD/MM/YYYY]
   • Hora: [HH:MM] (si aplica)
   • Ubicación: [lugar] (si aplica)
   • Prioridad: [alta/media/baja]

✅ Estado: [confirmación de la operación]
```

## Comandos soportados

### Crear eventos/recordatorios
- "agrega reunión con cliente mañana a las 3pm"
- "recordatorio para llamar al médico el viernes a las 10am"
- "crea evento para revisar proyecto el próximo lunes"
- "programa tarea de pagar facturas el día 15"
- "agreguemos las daily meetings a la agenda"
- "programa daily de lunes a viernes 9:30 a 10:30"
- "agregar a agenda reuniones diarias"
- "programar en calendario daily meetings"
- "tu tienes una agenda" (cuando pregunta por capacidad)
- "no las veo registradas en la agenda" (cuando necesita verificar eventos)

### Consultar agenda
- "qué tengo agendado para mañana"
- "muestrame mis recordatorios de esta semana"
- "qué eventos tengo para el viernes"
- "consultar agenda de los próximos 3 días"

### Modificar eventos
- "cambia la reunión de las 3pm a las 4pm"
- "modifica el recordatorio del médico para el martes"
- "actualiza la ubicación de la reunión del lunes"

### Eliminar eventos
- "elimina la reunión de mañana"
- "borra el recordatorio del médico"
- "cancela el evento del viernes por la tarde"

## Formato de creación

```
📆 Nuevo Evento Creado

📋 Detalles del evento:
   • Título: [título del evento]
   • Fecha: [DD/MM/YYYY]
   • Hora: [HH:MM]
   • Duración: [X horas/minutos]
   • Ubicación: [lugar]
   • Prioridad: [alta/media/baja]
   • Tipo: [reunión/tarea/recordatorio/personal]

⏰ Recordatorio configurado:
   • [X minutos antes] - [tipo de notificación]

📊 Confirmación:
   • Evento agregado al calendario: ✅
   • Recordatorio guardado en memoria: ✅
   • Notificación activada: ✅

💡 Próximos pasos:
   • [recomendación o acción siguiente]
```

## Formato de consulta

```
📅 Tu Agenda - [Período consultado]

📆 Eventos programados:
   • [fecha] - [hora] - [evento] - [ubicación]
   • [fecha] - [hora] - [evento] - [ubicación]

⏰ Recordatorios activos:
   • [fecha] - [hora] - [recordatorio] - [prioridad]

📋 Tareas pendientes:
   • [fecha] - [tarea] - [prioridad]

📊 Resumen del período:
   • Total eventos: [X]
   • Recordatorios: [X]
   • Tareas urgentes: [X]

⚠️ Próximos recordatorios (24hs):
   • [mañana a las HH:MM] - [recordatorio]
```

## Manejo de casos específicos

### Cuando pregunta si Enzo tiene agenda
```
📅 ¡Sí! Tengo una agenda completa integrada

✅ Capacidades de mi agenda:
   • Crear eventos y reuniones
   • Programar recordatorios
   • Gestión de daily meetings
   • Consultar eventos por fechas
   • Modificar y eliminar eventos

🔧 Herramientas disponibles:
   • Calendario del sistema integrado
   • Memoria persistente para recordatorios
   • Notificaciones automáticas

💡 Puedo ayudarte a:
   • Programar tus daily meetings de lunes a viernes
   • Agendar reuniones y recordatorios
   • Consultar qué tienes para hoy/mañana/esta semana

¿Qué te gustaría agendar ahora?
```

### Cuando no ve eventos registrados
```
🔍 Verificando eventos en tu agenda...

📅 Estado actual de la agenda:
   • Eventos hoy: [X]
   • Eventos esta semana: [Y]
   • Daily meetings programadas: [Sí/No]

⚠️ Si no ves las daily meetings:
   • Voy a programarlas ahora correctamente
   • Las guardaré tanto en calendario como en memoria
   • Configuraré recordatorios diarios

📝 Procedo a programar:
   • Daily meetings - Lunes a Viernes
   • Horario: 9:30 am - 10:30 am
   • Recordatorio: 9:25 am diario

✅ ¿Confirmas que programe estas daily meetings ahora?
```

## Formato de modificación

```
✏️ Evento Modificado

📋 Cambios realizados:
   • Evento: [título original]
   • Campo modificado: [campo]
   • Valor anterior: [valor antiguo]
   • Nuevo valor: [valor nuevo]

📊 Estado actualizado:
   • Calendario: ✅ actualizado
   • Memoria: ✅ sincronizado
   • Notificaciones: ✅ reconfiguradas

💡 Verificación:
   • [confirmación del cambio]
```

## Formato de eliminación

```
🗑️ Evento Eliminado

📋 Detalles del eliminado:
   • Título: [título del evento]
   • Fecha: [DD/MM/YYYY]
   • Hora: [HH:MM]
   • Motivo: [cancelación/traslado/completado]

📊 Limpieza realizada:
   • Calendario: ✅ evento removido
   • Memoria: ✅ recordatorio eliminado
   • Notificaciones: ✅ desactivadas

💡 Confirmación:
   • [mensaje de confirmación]
```

## Tipos de actividades

### 1. Eventos de calendario
- Reuniones profesionales
- Citas personales
- Clases y talleres
- Compromisos sociales

### 2. Recordatorios
- Llamadas importantes
- Fechas límite
- Recordatorios de medicación
- Aniversarios y cumpleaños

### 3. Tareas programadas
- Entregas de proyectos
- Pagos de facturas
- Mantenimiento periódico
- Objetivos personales

## Prioridades y categorías

### Prioridades
- **🔴 Alta**: Urgente, crítico, no posponible
- **🟡 Media**: Importante, flexible 24-48hs
- **🟢 Baja**: Puede posponerse sin impacto

### Categorías
- **💼 Trabajo**: Reuniones, proyectos, deadlines
- **👥 Personal**: Citas, sociales, familia
- **🏥 Salud**: Médicos, medicación, ejercicio
- **💰 Finanzas**: Pagos, inversiones, presupuestos
- **📚 Educación**: Clases, estudio, investigación

## Integración con otros skills

### Autonomous Work Manager
```javascript
// Programar checkpoints automáticos
recall("autonomous_work_reminders", {
  task_id: "project_x",
  checkpoints: [
    { time: "30min", action: "progress_report" },
    { time: "1hour", action: "status_check" },
    { time: "2hours", action: "completion_review" }
  ]
});
```

### Teaching Materials Creator
```javascript
// Recordatorios de preparación de clases
recall("teaching_reminders", {
  class: "programación_básica",
  preparation_reminders: [
    { date: "2024-01-15", time: "09:00", task: "revisar presentación" },
    { date: "2024-01-15", time: "10:00", task: "preparar ejercicios" }
  ]
});
```

### Morning/Evening Briefing
```javascript
// Consultar eventos del día
const todayEvents = recall("daily_events_" + new Date().toISOString().split('T')[0]);
```

## Manejo de errores

### Errores comunes
- **Fecha inválida**: Verificar formato DD/MM/YYYY
- **Hora no disponible**: Sugerir alternativas
- **Evento duplicado**: Confirmar si desea modificar existente
- **Permiso denegado**: Verificar acceso al calendario

### Estrategias de recuperación
1. **Validación previa**: Verificar datos antes de guardar
2. **Confirmación explícita**: Pedir aprobación para cambios importantes
3. **Backup automático**: Guardar versión anterior antes de modificar
4. **Sugerencias**: Proponer alternativas cuando hay conflictos

## Ejemplos de uso avanzado

### Series recurrentes
```
"crea reunión de equipo todos los lunes a las 10am por 4 semanas"
→ Configura evento recurrente con múltiples fechas
```

### Recordatorios inteligentes
```
"recuérdame preparar para la clase 1 hora antes"
→ Calcula hora dinámica basada en evento existente
```

### Integración con proyectos
```
"programa recordatorio para revisar el proyecto cada 2 días"
→ Crea recordatorios recurrentes para seguimiento
```

## Almacenamiento y persistencia

### Estructura de datos en memoria
```javascript
// Eventos
recall("events_" + date, {
  events: [
    {
      id: "event_123",
      title: "Reunión cliente",
      date: "2024-01-15",
      time: "15:00",
      duration: 60,
      location: "Oficina central",
      priority: "alta",
      category: "trabajo",
      reminders: [
        { time: "14:30", type: "notification" },
        { time: "14:50", type: "email" }
      ]
    }
  ]
});

// Recordatorios
recall("reminders_" + date, {
  reminders: [
    {
      id: "reminder_456",
      title: "Llamar al médico",
      date: "2024-01-16",
      time: "10:00",
      priority: "media",
      category: "salud",
      completed: false
    }
  ]
});
```

## Métricas de uso

### Estadísticas de seguimiento
- **Eventos creados**: X por semana/mes
- **Recordatorios cumplidos**: X% de cumplimiento
- **Modificaciones frecuentes**: eventos que cambian a menudo
- **Categorías más usadas**: trabajo, personal, salud

### Optimización de recordatorios
- **Horas pico**: momentos con más recordatorios
- **Efectividad**: recordatorios que se cumplen vs se ignoran
- **Anticipación**: tiempo ideal de recordatorio por tipo de evento

## Formatos de fecha y hora soportados

### Fechas
- **Relativas**: "mañana", "la próxima semana", "el mes que viene"
- **Absolutas**: "15/01/2024", "15 de enero", "15 de enero de 2024"
- **Días de semana**: "lunes", "viernes", "próximo martes"

### Horas
- **Formato 24h**: "15:30", "10:00"
- **Formato 12h**: "3:30pm", "10:00am"
- **Relativas**: "en 1 hora", "dentro de 30 minutos"

## Configuración regional

### Idioma y formato
- **Español**: Nombres de días y meses en español
- **Formato fecha**: DD/MM/YYYY estándar
- **Zona horaria**: Configurable según ubicación del usuario

### Personalización
- **Categorías personalizables**: Agregar nuevas categorías según necesidades
- **Prioridades adaptables**: Ajustar según preferencias del usuario
- **Tipos de notificación**: Email, push, sonido, etc.
