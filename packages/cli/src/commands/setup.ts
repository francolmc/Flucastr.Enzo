import { runWizard } from '../wizard/wizard.js';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { start } from './start.js';
import { createConfigService } from '../utils/config.js';

export async function setup(): Promise<void> {
  try {
    const result = await runWizard();

    if (!result.success) {
      console.log('\n');
      console.log(chalk.red(`❌ ${result.error}`));
      console.log('\n');
      process.exit(1);
    }

    console.log('\n');
    console.log(chalk.green('✅ ¡Configuración completada!\n'));

    if (result.startNow) {
      await buildRuntimePackages();
      await start();
      return;
    }

    console.log(chalk.white('Próximos pasos:'));
    console.log(chalk.cyan('  ./enzo start\n'));
  } catch (error) {
    console.log('\n');
    console.log(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log('\n');
    process.exit(1);
  }
}

async function buildRuntimePackages(): Promise<void> {
  const configService = createConfigService();
  const systemConfig = configService.getSystemConfig();
  const commands: Array<{ label: string; command: string; args: string[] }> = [
    {
      label: 'API',
      command: 'pnpm',
      args: ['-F', '@enzo/api', 'build'],
    },
  ];

  if (systemConfig.hasTelegramBotToken) {
    commands.push({
      label: 'Telegram',
      command: 'pnpm',
      args: ['-F', '@enzo/telegram', 'build'],
    });
  }

  console.log(chalk.cyan('🔧 Preparando servicios para iniciar...\n'));
  for (const task of commands) {
    console.log(chalk.blue(`• Compilando ${task.label}...`));
    await runCommand(task.command, task.args);
  }
  console.log(chalk.green('\n✅ Servicios listos.\n'));
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Falló "${command} ${args.join(' ')}" con código ${code}`));
      }
    });
  });
}
