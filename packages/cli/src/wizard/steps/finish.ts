import chalk from 'chalk';
import inquirer from 'inquirer';
import { createConfigService, getConfigPath } from '../../utils/config.js';

export interface WizardState {
  userName: string;
  ollamaBaseUrl: string;
  model: string;
  uiPort?: string;
  telegramToken?: string;
  telegramUserId?: string;
  assistantName: string;
  tone: string;
}

export interface FinishResult {
  success: boolean;
  startNow?: boolean;
  error?: string;
}

export async function finish(state: WizardState): Promise<FinishResult> {
  try {
    console.log('\n');
    console.log(chalk.green('✅ ¡Todo listo, ' + state.userName + '!\n'));

    console.log(chalk.white('Tu configuración:'));
    console.log(chalk.gray(`  • Modelo: ${state.model}`));
    console.log(chalk.gray(`  • Asistente: ${state.assistantName}`));
    console.log(chalk.gray(`  • Personalidad: ${getToneLabel(state.tone)}`));
    if (state.telegramToken) {
      console.log(chalk.gray('  • Telegram: conectado'));
    } else {
      console.log(chalk.gray('  • Telegram: no configurado'));
    }
    console.log('\n');

    const configService = createConfigService();
    configService.setPrimaryModel(state.model);
    configService.setSystemConfig({
      ollamaBaseUrl: state.ollamaBaseUrl,
      port: '3001',
      dbPath: './enzo.db',
      enzoWorkspacePath: './workspace',
      telegramAllowedUsers: state.telegramUserId || '',
      telegramAgentOwnerUserId: state.telegramUserId || '',
      ...(state.telegramToken ? { telegramBotToken: state.telegramToken } : {}),
    });
    configService.setAssistantProfile({
      name: state.assistantName,
      tone: state.tone,
    });
    configService.setUserProfile({
      displayName: state.userName,
      locale: 'es',
    });

    console.log(chalk.green(`✅ Configuración guardada en ${getConfigPath()}\n`));

    console.log(chalk.white('Para iniciar Enzo escribe:'));
    console.log(chalk.cyan('  pnpm exec enzo start\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'uiPort',
        message: '¿En qué puerto quieres que corra la Web UI?',
        default: state.uiPort || '5173',
        validate: (input: string) => {
          const value = Number(input.trim());
          if (!Number.isInteger(value) || value < 1 || value > 65535) {
            return 'Ingresa un puerto válido (1-65535)';
          }
          return true;
        },
      },
      {
        type: 'confirm',
        name: 'startNow',
        message: '¿Quieres iniciarlo ahora?',
        default: true,
      },
    ]);

    configService.setSystemConfig({
      uiPort: String(answers.uiPort).trim(),
    });

    return { success: true, startNow: Boolean(answers.startNow) };
  } catch (error) {
    return {
      success: false,
      error: `Error finalizando configuración: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function getToneLabel(tone: string): string {
  switch (tone) {
    case 'informal':
      return 'Informal y cercano';
    case 'formal':
      return 'Formal y profesional';
    case 'direct':
      return 'Directo y conciso';
    default:
      return tone;
  }
}
