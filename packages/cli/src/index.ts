#!/usr/bin/env node

import chalk from 'chalk';
import { setup } from './commands/setup.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { status } from './commands/status.js';
import { update } from './commands/update.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case 'setup':
        await setup();
        break;
      case 'start':
        await start();
        break;
      case 'stop':
        await stop();
        break;
      case 'status':
        await status();
        break;
      case 'update':
        await update();
        break;
      case '--help':
      case '-h':
      case 'help':
        showHelp();
        break;
      case '--version':
      case '-v':
        console.log('Enzo CLI v0.1.0');
        break;
      default:
        console.log('\n');
        console.log(chalk.red(`❌ Comando desconocido: ${command}\n`));
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.log('\n');
    console.log(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log('\n');
    process.exit(1);
  }
}

function showHelp(): void {
  console.log('\n');
  console.log(chalk.cyan('🦊 Enzo CLI - Tu asistente personal\n'));

  console.log(chalk.white('Uso:'));
  console.log(chalk.gray('  ./enzo <comando>\n'));

  console.log(chalk.white('Comandos:'));
  console.log(chalk.gray('  setup    Configurar Enzo (wizard interactivo)'));
  console.log(chalk.gray('  start    Iniciar Web UI + API (+ Telegram opcional)'));
  console.log(chalk.gray('  stop     Mostrar cómo detener servicios'));
  console.log(chalk.gray('  status   Ver estado de la configuración'));
  console.log(chalk.gray('  update   Actualizar Enzo'));
  console.log(chalk.gray('  help     Mostrar esta ayuda\n'));

  console.log(chalk.white('Ejemplos (desde la raíz del repositorio):'));
  console.log(chalk.cyan('  ./enzo setup'));
  console.log(chalk.cyan('  ./enzo start'));
  console.log(chalk.cyan('  ./enzo status\n'));
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
