import assert from 'node:assert/strict';
import {
  hasExplicitReminderCue,
  hasTemporalCue,
  isTemporalReminderIntent,
} from '../reminderIntentHeuristics.js';

function runTests(): void {
  assert.equal(
    isTemporalReminderIntent('me podrías recordar tomar un medicamento a las 9:11 am?'),
    true
  );
  assert.equal(isTemporalReminderIntent('avísame mañana a las 18:30 de la reunión'), true);

  assert.equal(hasExplicitReminderCue('tengo reunión a las 18:30'), false);
  assert.equal(hasTemporalCue('tengo reunión a las 18:30'), true);
  assert.equal(isTemporalReminderIntent('tengo reunión a las 18:30'), false);

  assert.equal(isTemporalReminderIntent('recuérdame lo del medicamento'), false);

  console.log('ReminderIntentHeuristics tests passed');
}

runTests();

