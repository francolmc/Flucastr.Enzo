# Echo

## La autonomía de Enzo

Echo es el sistema de tareas autónomas de Enzo. Su responsabilidad es **permitir que Enzo actúe sin que el usuario lo pida**.

## Principio

> Echo convierte a Enzo de asistente reactivo en asistente proactivo.

Sin Echo, Enzo solo responde. Con Echo, Enzo actúa — revisa, procesa, notifica — mientras el usuario vive su vida.

## La diferencia
Sin Echo:
Usuario pregunta → Enzo responde
Usuario no pregunta → Enzo no hace nada
Con Echo:
Usuario pregunta → Enzo responde
Mientras tanto → Echo ejecuta tareas programadas
Echo termina → notifica al usuario por Telegram

## Casos de uso reales

**Briefing matutino**
Todos los días a las 7:00 AM:
- Busca las noticias más relevantes del día
- Lee el archivo de tareas pendientes
- Genera un resumen y lo envía por Telegram

**Preparación de clases INACAP**
Todos los domingos a las 6:00 PM:
- Revisa qué clases hay la próxima semana
- Busca material actualizado para cada tema
- Guarda el material en la carpeta de la clase

**Seguimiento de proyectos**
Cada viernes a las 5:00 PM:
- Lee los archivos de cada proyecto activo
- Detecta tareas sin completar
- Envía resumen de estado por Telegram

**Limpieza automática**
Cada primer domingo del mes:
- Lista archivos temporales en Downloads
- Mueve los más viejos a una carpeta de archivo
- Informa al usuario lo que hizo

## Cómo funciona

Echo usa el mismo Planner y Manos que el asistente conversacional. La diferencia es el origen del mensaje — no viene del usuario, viene de un cron job.
Cron job dispara a las 7:00 AM
↓
Echo construye el mensaje: "genera mi briefing matutino"
↓
Planner decide → busca noticias → lee tareas → sintetiza
↓
Manos ejecuta cada paso
↓
Echo envía el resultado por Telegram

## Definición de jobs

Los jobs de Echo se definen en `~/.enzo/echo.json`:

```json
{
  "jobs": [
    {
      "id": "morning-briefing",
      "name": "Briefing matutino",
      "schedule": "0 7 * * 1-5",
      "message": "Genera mi briefing matutino: busca las 3 noticias más importantes sobre tecnología e IA, y muéstrame mis tareas pendientes del día.",
      "notify": true
    },
    {
      "id": "weekly-class-prep",
      "name": "Preparación de clases",
      "schedule": "0 18 * * 0",
      "message": "Prepara el material para mis clases de INACAP de la próxima semana.",
      "notify": true
    }
  ]
}
```

## Notificaciones

Cuando Echo completa una tarea, envía el resultado por Telegram. El usuario recibe el resultado en su celular sin haber pedido nada.

Si Echo falla, también notifica — con el error y qué intentó hacer.

## Horario silencioso

Echo respeta el timezone del usuario y puede configurarse para no notificar entre ciertas horas — por ejemplo, no despertar al usuario a las 3 AM si un job tardó más de lo esperado.

## Lo que Echo NO hace

- No actúa sin que el usuario haya definido el job
- No toma decisiones que el usuario no autorizó
- No tiene acceso a más herramientas que el asistente conversacional
- No aprende solo qué jobs crear — eso lo decide el usuario

## Relación con los otros sistemas
Echo
→ usa Planner para decidir cada paso
→ usa Manos para ejecutar
→ lee Raíz para contexto del usuario
→ usa Ritos si el job tiene un workflow aprendido
→ notifica via Telegram cuando termina

## Estado actual

- 🔄 No implementado en core v2
- ✅ Concepto validado en core v1 (EchoEngine.ts)
- 🔄 Pendiente para Semana 3 del roadmap

## Prioridad de implementación

1. Jobs declarativos via `echo.json`
2. Ejecución via el mismo loop Planner → Manos
3. Notificación por Telegram al terminar
4. UI simple para gestionar jobs — después

## El nombre

Echo — porque resuena. El usuario define una intención una vez, y Echo la repite en el momento correcto, una y otra vez, sin que el usuario tenga que recordarla.

Como el eco en el desierto de Atacama — silencioso hasta que lo necesitas, pero siempre presente.