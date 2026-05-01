import { strict as assert } from 'node:assert';
import { extractProjectsFromMemoryText } from '../extractProjectsFromMemoryText.js';

async function runTests(): Promise<void> {
  console.log('extractProjectsFromMemoryText tests...\n');

  console.log('Test: key projects with Nombre del proyecto label (Byteria)');
  const labeled = extractProjectsFromMemoryText([
    {
      key: 'projects',
      updatedAt: 1_700_000_000_000,
      value: [
        'Resumen del contexto.',
        '- **Nombre del proyecto**: Byteria',
        'Un juego para estudiantes; backend NestJS.',
        '- Revisar modelo de personajes',
      ].join('\n'),
    },
  ]);
  assert.equal(labeled.length, 1);
  assert.equal(labeled[0]?.name, 'Byteria');
  assert.ok(
    labeled[0]?.pendingItems.some((item) => item.includes('personajes')),
    'expected bullet pending extracted'
  );
  console.log('✓ Passed\n');

  console.log('Test: key projects uses first-line title without label');
  const firstLine = extractProjectsFromMemoryText([
    {
      key: 'projects',
      updatedAt: 1_700_000_100_000,
      value:
        'Byteria — juego educativo; TypeScript, NestJS, Postgres, React Router v7.',
    },
  ]);
  assert.equal(firstLine.length, 1);
  assert.ok(firstLine[0]?.name.includes('Byteria'));
  console.log('✓ Passed\n');

  console.log('Test: legacy OTHER row mentioning Dash keeps pattern matcher');
  const dash = extractProjectsFromMemoryText([
    {
      key: 'other',
      updatedAt: 1_600_000_000_000,
      value: 'Seguimos el roadmap dash para lanzamiento beta.',
    },
  ]);
  assert.equal(dash.length, 1);
  assert.equal(dash[0]?.name, 'Dash');
  console.log('✓ Passed\n');

  console.log('Test: guarded other row with proyecto: label picks name');
  const scopedOther = extractProjectsFromMemoryText([
    {
      key: 'other',
      updatedAt: 1_650_000_000_000,
      value:
        'Proyecto:\nNombre interno Temporalium\n(no encaja proyectos conocidos pero tiene marcador proyecto:)',
    },
  ]);
  assert.equal(scopedOther.length, 1);
  console.log('✓ Passed\n');

  console.log('All extractProjectsFromMemoryText tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
