import chalk from 'chalk';
import { configExists, createConfigService, getConfigPath } from '../utils/config.js';

export async function status(): Promise<void> {
  try {
    if (!configExists()) {
      console.log('\n');
      console.log(chalk.yellow('⚠️  No hay configuración.\n'));
      console.log(chalk.white('Ejecuta primero:\n'));
      console.log(chalk.cyan('  pnpm exec enzo setup\n'));
      return;
    }
    const configService = createConfigService();
    const systemConfig = configService.getSystemConfig();
    const primaryModel = configService.getPrimaryModel();

    console.log('\n');
    console.log(chalk.cyan('🦊 Estado de Enzo\n'));

    console.log(chalk.white('Configuración:'));
    console.log(chalk.gray(`  • Archivo: ${getConfigPath()}`));
    console.log(chalk.gray(`  • Modelo: ${primaryModel}`));
    console.log(chalk.gray(`  • API Puerto: ${systemConfig.port}`));
    console.log(chalk.gray(`  • Web UI Puerto: ${systemConfig.uiPort}`));
    console.log(chalk.gray(`  • Base de datos: ${systemConfig.dbPath}`));
    console.log(chalk.gray(`  • Workspace: ${systemConfig.enzoWorkspacePath}`));

    if (systemConfig.hasTelegramBotToken) {
      console.log(chalk.gray('  • Telegram: configurado'));
    } else {
      console.log(chalk.gray('  • Telegram: no configurado'));
    }

    console.log('\n');
    console.log(chalk.white('Para iniciar Enzo:'));
    console.log(chalk.cyan('  pnpm exec enzo start\n'));
  } catch (error) {
    console.log('\n');
    console.log(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log('\n');
    process.exit(1);
  }
}
