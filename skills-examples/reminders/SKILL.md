---
name: reminders
description: Instrucciones para programar recordatorios puntuales con la herramienta schedule_reminder. Úsame cuando el usuario pida alarma, recordatorio a una hora, o "avísame cuando…".
version: 1.0.0
author: enzo-team
---

# Recordatorios (schedule_reminder)

- La entrega en **Telegram** usa el chat actual. En **web** (API) el recordatorio se guarda pero no hay push en MVP: confirma con el usuario si usa Telegram o la app.
- Pide la **zona horaria** si el usuario no dio offset explícito (ej. "a las 15" sin decir "hora local Chile").
- Pasa `runAt` en **ISO-8601 con offset o Z** cuando sea posible, por ejemplo `2026-04-25T15:00:00-04:00`, o la hora de hoy/mañana de forma explícita.
- `text` debe ser la frase que verá al dispararse (ej. "Dentista", "Llamar a mamá").
- Tras agendar, confirma id y hora en UTC o local de forma clara.
- No prometas notificación en web si el usuario solo usa la app sin Telegram.
