import { InputChunker } from './InputChunker.js';
import { buildChunkCaptureConfirmation, getMemoryExtractionMessages } from './ChunkCapture.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runTests(): Promise<void> {
  console.log('InputChunker tests...\n');
  const chunker = new InputChunker();

  console.log('Test: 3 pendientes separados -> 3 chunks');
  const message3 = [
    'Primero necesito revisar los pendientes del proyecto con calma para no olvidar nada.',
    'Además tengo que preparar los mensajes para clientes y dejar listos los borradores de manana.',
    'Por otro lado tambien tengo que ordenar los documentos del equipo en una carpeta compartida.',
  ].join(' ');
  const result3 = chunker.chunk(message3);
  assert(result3.isLong, 'expected isLong=true for 3 pending items');
  assert(result3.chunks.length === 3, `expected 3 chunks, got ${result3.chunks.length}`);
  console.log('✓ Passed\n');

  console.log('Test: maximo de 10 chunks y min 5 palabras');
  const repeated = new Array(12)
    .fill('Necesito revisar tareas pendientes del sprint actual con detalles completos para hoy')
    .join('. ');
  const resultMax = chunker.chunk(repeated);
  assert(resultMax.isLong, 'expected isLong=true for long repeated message');
  assert(resultMax.chunks.length === 10, `expected max 10 chunks, got ${resultMax.chunks.length}`);
  assert(
    resultMax.chunks.every((chunk) => chunk.content.split(/\s+/).length >= 5),
    'expected every chunk to have at least 5 words'
  );
  console.log('✓ Passed\n');

  console.log('Test: memoria por chunk y confirmacion completa');
  const memoryMessages = getMemoryExtractionMessages(message3, result3);
  assert(memoryMessages.length === 3, `expected 3 memory messages, got ${memoryMessages.length}`);
  const confirmation = buildChunkCaptureConfirmation(result3);
  assert(confirmation.startsWith('Capturé 3 cosas:'), 'expected confirmation with captured count');
  assert(confirmation.includes('¿Querés que priorice alguna?'), 'expected prioritization question');
  console.log('✓ Passed\n');

  console.log('InputChunker tests passed.');
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
