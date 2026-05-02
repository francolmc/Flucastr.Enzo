import {
  resolveCalendarListFastPathIntent,
  resolveCalendarScheduleFastPathIntent,
} from '../Classifier.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

console.log('Calendar prefersHostTools routing tests...\n');

{
  const msg = 'muéstrame la lista de repositorios que estan en mi github';
  assert(
    resolveCalendarListFastPathIntent({
      message: msg,
      prefersHostTools: true,
    }) === false,
    'list repos + prefersHostTools must NOT open calendar-list fast path'
  );
  assert(
    resolveCalendarScheduleFastPathIntent({
      message: 'programar reunión mañana 9am',
      prefersHostTools: true,
    }) === false,
    'schedule cues + prefersHostTools without calendar Intent must NOT open calendar-schedule lexical path'
  );
  console.log('ok: prefersHostTools blocks lexical calendar inference');
}

{
  assert(
    resolveCalendarListFastPathIntent({
      message: 'qué citas tengo hoy',
      suggestedTool: 'calendar',
      calendarIntent: 'list',
    }) === true,
    'explicit classifier calendar list must still activate'
  );
  console.log('ok: explicit calendarIntent list still activates');
}

{
  assert(
    resolveCalendarScheduleFastPathIntent({
      message: 'agendar médico mañana 10:30',
      suggestedTool: 'calendar',
      calendarIntent: 'schedule',
    }) === true,
    'explicit classifier calendar schedule must still activate'
  );
  console.log('ok: explicit calendarIntent schedule still activates');
}

console.log('\nCalendar prefersHostTools routing tests passed.');
