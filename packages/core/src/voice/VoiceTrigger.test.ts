import { requestsVoiceResponse } from './VoiceTrigger.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runTests(): Promise<void> {
  console.log('Test: "respondeme por voz" retorna true');
  assert(requestsVoiceResponse('respondeme por voz') === true, 'Expected trigger to match');

  console.log('Test: "en audio porfa" retorna true');
  assert(requestsVoiceResponse('en audio porfa') === true, 'Expected trigger to match');

  console.log('Test: "busca el clima" retorna false');
  assert(requestsVoiceResponse('busca el clima') === false, 'Expected trigger not to match');

  console.log('Test: Case insensitive "Respondeme Por Voz" retorna true');
  assert(requestsVoiceResponse('Respondeme Por Voz') === true, 'Expected case-insensitive match');

  console.log('Test: Lista de triggers custom');
  assert(
    requestsVoiceResponse('hola por favor responde en voz ahora', ['responde en voz']) === true,
    'Expected custom trigger to match'
  );
  assert(
    requestsVoiceResponse('hola por favor responde en voz ahora', ['algo otro']) === false,
    'Expected custom trigger to miss'
  );

  console.log('✓ Passed: VoiceTrigger.test');
}

runTests().catch((error) => {
  console.error('✗ Failed: VoiceTrigger.test');
  console.error(error);
  process.exit(1);
});
