export function hasExplicitReminderCue(message: string): boolean {
  return /\b(recu[eé]rdame|recorda(?:r|me)?|av[ií]same|alarm(?:a|ar)|remind(?: me)?|recordatorio)\b/i.test(
    message
  );
}

export function hasTemporalCue(message: string): boolean {
  return (
    /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i.test(message) ||
    /\b(hoy|mañana|manana|esta tarde|esta noche|at \d{1,2}(:\d{2})?\s*(?:am|pm)?)\b/i.test(message)
  );
}

/** Reminder request that should prioritize schedule_reminder over remember. */
export function isTemporalReminderIntent(message: string): boolean {
  return hasExplicitReminderCue(message) && hasTemporalCue(message);
}

