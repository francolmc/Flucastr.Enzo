import { scheduleEnzoSupervisorRestart } from '@enzo/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { spawn } from 'child_process';

export async function update(): Promise<void> {
  try {
    console.log('\n');
    console.log(chalk.cyan('🔄 Actualizando Enzo\n'));

    await ensureGitRepository();
    await confirmProceedIfDirty();

    console.log(chalk.blue('• Sincronizando cambios remotos...'));
    await runCommand('git', ['pull', '--ff-only']);

    console.log(chalk.blue('• Instalando dependencias...'));
    await runCommand('pnpm', ['install']);

    console.log(chalk.blue('• Compilando paquetes...'));
    await runCommand('pnpm', ['build']);

    console.log(chalk.blue('• Verificando estado final...'));
    await runCommand('pnpm', ['exec', 'enzo', 'status']);

    const restart = scheduleEnzoSupervisorRestart({ cwd: process.cwd() });
    if (restart.kind === 'skipped') {
      console.log(chalk.yellow('• Reinicio: ') + restart.userMessage);
    } else {
      console.log(chalk.cyan('• ') + restart.userMessage);
    }

    console.log('\n');
    console.log(chalk.green('✅ Enzo actualizado correctamente.\n'));
  } catch (error) {
    console.log('\n');
    console.log(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log('\n');
    process.exit(1);
  }
}

async function ensureGitRepository(): Promise<void> {
  const result = await runCommandCapture('git', ['rev-parse', '--is-inside-work-tree']);
  if (!result.stdout.includes('true')) {
    throw new Error('Este comando debe ejecutarse dentro de un repositorio Git.');
  }
}

async function confirmProceedIfDirty(): Promise<void> {
  const result = await runCommandCapture('git', ['status', '--porcelain']);
  const hasChanges = result.stdout.trim().length > 0;
  if (!hasChanges) {
    return;
  }

  console.log(chalk.yellow('⚠️  Hay cambios locales sin commit en este repositorio.\n'));

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continueUpdate',
      message: '¿Quieres continuar con la actualización de todos modos?',
      default: false,
    },
  ]);

  if (!answer.continueUpdate) {
    throw new Error('Actualización cancelada por el usuario.');
  }
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

function runCommandCapture(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `Falló "${command} ${args.join(' ')}" con código ${code}${stderr ? `: ${stderr.trim()}` : ''}`
          )
        );
      }
    });
  });
}
