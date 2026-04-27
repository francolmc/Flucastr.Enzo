import chalk from 'chalk';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { clearEnzoSupervisorState, writeEnzoSupervisorState } from '@enzo/core';
import { configExists, createConfigService } from '../utils/config.js';

export async function start(): Promise<void> {
  try {
    if (!configExists()) {
      console.log('\n');
      console.log(chalk.red('❌ No hay configuración. Ejecuta primero:\n'));
      console.log(chalk.cyan('  ./enzo setup\n'));
      process.exit(1);
    }
    const configService = createConfigService();
    const systemConfig = configService.getSystemConfig();
    const hasTelegramToken = Boolean(configService.getSystemSecret('telegramBotTokenEncrypted'));
    const apiPort = systemConfig.port || '3001';
    const uiPort = systemConfig.uiPort || '5173';

    console.log('\n');
    console.log(chalk.cyan('🦊 Iniciando Enzo...\n'));

    const processes: any[] = [];
    const repoRoot = process.cwd();
    const apiDistPath = path.resolve(repoRoot, 'packages/api/dist/index.js');
    const telegramDistPath = path.resolve(repoRoot, 'packages/telegram/dist/index.js');

    if (!fs.existsSync(apiDistPath)) {
      console.log(chalk.red('❌ API no compilada.\n'));
      console.log(chalk.white('Compila primero con:\n'));
      console.log(chalk.cyan('  pnpm build\n'));
      process.exit(1);
    }

    // Start Web UI
    console.log(chalk.blue(`🌐 Iniciando Web UI en puerto ${uiPort}...`));
    const uiProcess = spawn(
      'pnpm',
      ['-F', '@enzo/ui', 'dev', '--', '--host', '0.0.0.0', '--port', uiPort, '--strictPort'],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          VITE_UI_PORT: uiPort,
          VITE_API_TARGET: `http://localhost:${apiPort}`,
        },
      }
    );
    processes.push(uiProcess);

    // Start API
    console.log(chalk.blue(`🚀 Iniciando API en puerto ${apiPort}...`));
    const apiProcess = spawn('pnpm', ['-F', '@enzo/api', 'start'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    });
    processes.push(apiProcess);

    // Start Telegram if configured
    if (hasTelegramToken) {
      if (!fs.existsSync(telegramDistPath)) {
        console.log(chalk.red('❌ Telegram está configurado pero no compilado.\n'));
        console.log(chalk.white('Compila primero con:\n'));
        console.log(chalk.cyan('  pnpm build\n'));
        process.exit(1);
      }

      console.log(chalk.blue('🤖 Iniciando Telegram...'));
      const telegramProcess = spawn('pnpm', ['-F', '@enzo/telegram', 'start'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: true,
      });
      processes.push(telegramProcess);
    }

    console.log('\n');
    console.log(chalk.green('✅ Enzo está corriendo.\n'));
    console.log(chalk.white(`• Web UI: http://localhost:${uiPort}`));
    console.log(chalk.white(`• API: http://localhost:${apiPort}`));
    if (hasTelegramToken) {
      console.log(chalk.white('• Telegram: habla con tu bot'));
    }
    console.log('\n');
    console.log(chalk.yellow('Presiona Ctrl+C para detener.\n'));

    writeEnzoSupervisorState(repoRoot, process.pid);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n');
      console.log(chalk.yellow('Deteniendo servicios...'));
      clearEnzoSupervisorState(repoRoot);
      processes.forEach((proc) => {
        if (proc && proc.pid) {
          proc.kill('SIGTERM');
        }
      });
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });

    process.on('SIGTERM', () => {
      console.log('\n');
      console.log(chalk.yellow('Deteniendo servicios...'));
      clearEnzoSupervisorState(repoRoot);
      processes.forEach((proc) => {
        if (proc && proc.pid) {
          proc.kill('SIGTERM');
        }
      });
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });
  } catch (error) {
    console.log('\n');
    console.log(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log('\n');
    process.exit(1);
  }
}
