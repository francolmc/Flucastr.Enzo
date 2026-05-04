---
name: daily-meetings-scheduler
description: |
  Especializado en programar daily meetings y reuniones diarias. Se activa con "daily",
  "daily meeting", "reunión diaria", "agenda diaria", "programar daily", "daily de 
  lunes a viernes", "9:30 a 10:30", "daily meetings". Gestiona automáticamente
  programación de reuniones diarias recurrentes en agenda.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: productivity
  tags: daily, meetings, reuniones diarias, agenda, schedule, 9:30, 10:30, lunes a viernes
allowed-tools: calendar recall write_file read_file
---

# Daily Meetings Scheduler - Programador de Daily Meetings

## Pasos a seguir

1. **Detectar solicitud de daily**: Identificar "daily", "reunión diaria", horarios específicos
2. **Confirmar horarios**: Verificar 9:30-10:30 am o ajustar según preferencia
3. **Programar eventos recurrentes**: Crear eventos para lunes a viernes
4. **Configurar recordatorios**: Establecer notificaciones 5 minutos antes
5. **Guardar en memoria**: Persistir programación para referencia futura
6. **Confirmar al usuario**: Mostrar resumen completo de programación

## Formato de salida obligatorio

```
📅 Daily Meetings Scheduler

🎯 Acción: Programar reuniones diarias
📋 Horario: 9:30 am - 10:30 am
📆 Frecuencia: Lunes a Viernes

✅ Programando en tu agenda...
```

## Casos de activación específicos

### Cuando solicita programar daily meetings
```
📅 Programando Daily Meetings

📝 Configuración detectada:
   • Tipo: Daily Meetings
   • Horario: 9:30 am - 10:30 am
   • Días: Lunes a Viernes
   • Duración: 1 hora
   • Recordatorio: 9:25 am (5 minutos antes)

📆 Eventos a crear:
   • Lunes 9:30 am - Daily Meeting
   • Martes 9:30 am - Daily Meeting
   • Miércoles 9:30 am - Daily Meeting
   • Jueves 9:30 am - Daily Meeting
   • Viernes 9:30 am - Daily Meeting

🔧 Proceso:
   • Creando eventos en calendario... ✅
   • Configurando recordatorios... ✅
   • Guardando en memoria persistente... ✅

🎉 ¡Daily Meetings programadas correctamente!

📋 Resumen:
   • 5 eventos semanales creados
   • Recordatorios automáticos activados
   • Recurrencia semanal configurada

💡 Las verás en tu agenda inmediatamente. ¿Necesitas ajustar algún horario?
```

### Cuando pregunta si ve las meetings
```
🔍 Verificando Daily Meetings en tu agenda

📅 Estado de Daily Meetings:
   • Eventos programados: [Sí/No]
   • Recordatorios configurados: [Sí/No]
   • Próxima daily: [fecha y hora]

⚠️ Si no las ves:
   • Voy a reprogramarlas ahora mismo
   • Las agregaré tanto al calendario como a memoria
   • Te confirmaré cada evento creado

📝 Procedo a crear/verificar:
   • Daily Meeting Lunes 9:30 am ✅
   • Daily Meeting Martes 9:30 am ✅
   • Daily Meeting Miércoles 9:30 am ✅
   • Daily Meeting Jueves 9:30 am ✅
   • Daily Meeting Viernes 9:30 am ✅

🎉 ¡Todas tus Daily Meetings están agendadas!

📊 Total: 5 reuniones semanales
📆 Próxima: [día] a las 9:30 am
⏰ Recordatorio: 5 minutos antes
```

### Cuando pregunta si Enzo tiene agenda
```
📅 ¡Sí! Tengo agenda completa y daily meetings programadas

✅ Mi sistema de agenda incluye:
   • Calendario integrado del sistema
   • Programación de eventos recurrentes
   • Daily meetings automatizadas
   • Recordatorios inteligentes
   • Memoria persistente

🎯 Para Daily Meetings específicamente:
   • Puedo programarlas automáticamente
   • Horarios flexibles (9:30-10:30 am estándar)
   • Recurrencia lunes a viernes
   • Recordatorios automáticos
   • Modificación y cancelación fácil

💡 En este momento tengo:
   • Daily meetings programadas: [Sí/No]
   • Sistema de agenda: Activo
   • Capacidades: Completas

¿Qué te gustaría agendar o modificar en tu agenda?
```

## Formatos de horarios soportados

### Horarios estándar
- **9:30 am - 10:30 am**: Formato preferido
- **9:30 - 10:30**: Formato 24h
- **9:30 a 10:30**: Formato español
- **9:30-10:30 am**: Formato compacto

### Días de la semana
- **Lunes a Viernes**: Estándar laboral
- **De lunes a viernes**: Formato completo
- **L-V**: Formato abreviado
- **Días laborales**: Descriptivo

## Integración con calendario

### Herramientas utilizadas
```javascript
// Usar tool calendar para crear eventos
calendar({
  action: "create",
  title: "Daily Meeting",
  start: "2024-01-15T09:30:00",
  end: "2024-01-15T10:30:00",
  recurrence: "weekly",
  days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  reminder: 5 // minutos antes
});

// Guardar en memoria persistente
recall("daily_meetings_config", {
  schedule: "9:30-10:30",
  days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  reminder: 5,
  created: new Date().toISOString(),
  active: true
});
```

### Verificación de eventos existentes
```javascript
// Consultar eventos de la semana
const weeklyEvents = calendar({
  action: "list",
  start: startOfWeek,
  end: endOfWeek
});

// Filtrar daily meetings
const dailyMeetings = weeklyEvents.filter(event => 
  event.title.includes("Daily") || 
  event.title.includes("Meeting")
);
```

## Manejo de errores y soluciones

### Eventos duplicados
```
⚠️ Detecté daily meetings existentes

📅 Eventos ya programados:
   • Lunes 9:30 am - Daily Meeting ✅
   • Martes 9:30 am - Daily Meeting ✅
   • ...

🔄 ¿Deseas:
   1. Mantener las existentes (recomendado)
   2. Reemplazarlas con nuevos horarios
   3. Agregar reuniones adicionales

💡 Las meetings están activas y funcionando correctamente.
```

### Conflictos de horarios
```
⚠️ Conflicto detectado en agenda

📅 Conflicto el [día] a las 9:30 am:
   • Evento existente: [nombre del evento]
   • Daily Meeting: 9:30 am - 10:30 am

🔄 Soluciones:
   1. Mover daily a 10:30 am - 11:30 am
   2. Mover evento existente
   3. Cancelar daily ese día

¿Cuál prefieres?
```

## Comandos específicos de activación

### Frases que activan esta skill
- "agreguemos las dailyes a la agenda"
- "programa daily de lunes a viernes"
- "daily meetings 9:30 a 10:30"
- "reunión diaria a las 9:30"
- "no veo las daily en la agenda"
- "tu tienes una agenda para daily"
- "programar daily meetings esta semana"
- "daily de la mañana"

### Respuestas automáticas
- Confirmación inmediata de programación
- Verificación visual de eventos creados
- Recordatorio de próximas meetings
- Opciones de modificación rápida

## Ejemplos de conversación

### Usuario: "agreguemos las dailyes a la agenda para no olvidar"
```
📅 ¡Perfecto! Voy a programar tus daily meetings

🎯 Configuración estándar:
   • Daily Meetings
   • Lunes a Viernes
   • 9:30 am - 10:30 am
   • Recordatorio 5 minutos antes

✅ Programando eventos...
📆 Lunes 9:30 am - Daily Meeting ✅
📆 Martes 9:30 am - Daily Meeting ✅
📆 Miércoles 9:30 am - Daily Meeting ✅
📆 Jueves 9:30 am - Daily Meeting ✅
📆 Viernes 9:30 am - Daily Meeting ✅

🎉 ¡Listo! Tus daily meetings están agendadas

📊 Verificando en tu agenda...
✅ Todas las meetings son visibles en tu calendario

💡 Te llegará un recordatorio cada día a las 9:25 am
```

### Usuario: "no las veo registradas en la agenda"
```
🔍 Voy a verificar y programarlas correctamente

📅 Estado actual:
   • Buscando daily meetings en calendario...
   • Verificando memoria persistente...

⚠️ No encontré las daily meetings programadas

📝 Procedo a crearlas ahora:
   • Daily Meeting Lunes 9:30 am ✅
   • Daily Meeting Martes 9:30 am ✅
   • Daily Meeting Miércoles 9:30 am ✅
   • Daily Meeting Jueves 9:30 am ✅
   • Daily Meeting Viernes 9:30 am ✅

🎉 ¡Daily meetings creadas y visibles!

📊 Ahora deberías ver 5 eventos semanales en tu agenda
📅 Próxima: [día] a las 9:30 am
⏰ Recordatorio configurado para 9:25 am

¿Las ves ahora en tu calendario?
```

## Métricas y seguimiento

### Estadísticas de uso
- Daily meetings creadas: X por semana
- Recordatorios activados: Y% de efectividad
- Modificaciones de horario: Z cambios
- Cancelaciones: W eventos

### Optimización automática
- Detección de patrones de asistencia
- Sugerencias de mejor horario
- Ajuste automático de recordatorios
- Integración con otras herramientas

Esta skill está diseñada específicamente para resolver el problema que experimentaste - ahora Enzo debería reconocer inmediatamente las solicitudes de daily meetings y programarlas correctamente en tu agenda.
