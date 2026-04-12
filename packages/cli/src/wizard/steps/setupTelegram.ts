import chalk from 'chalk';
import inquirer from 'inquirer';

export interface SetupTelegramResult {
  success: boolean;
  data?: { token?: string; userId?: string };
  error?: string;
}

const TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]+$/;

export async function setupTelegram(): Promise<SetupTelegramResult> {
  try {
    console.log('\n');
    console.log(chalk.cyan('🤖 Configurar Telegram (opcional pero recomendado)\n'));

    console.log(chalk.white('Con Telegram puedes hablar con Enzo desde tu celular,'));
    console.log(chalk.white('en cualquier momento y lugar.\n'));

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupTelegram',
        message: '¿Quieres conectar Enzo con Telegram?',
        default: true,
      },
    ]);

    if (!answers.setupTelegram) {
      return { success: true, data: {} };
    }

    console.log('\n');
    console.log(chalk.white('Necesito el token de tu bot de Telegram.\n'));
    console.log(chalk.gray('Si no tienes uno:'));
    console.log(chalk.gray('1. Abre Telegram y busca @BotFather'));
    console.log(chalk.gray('2. Escribe /newbot'));
    console.log(chalk.gray('3. Sigue las instrucciones'));
    console.log(chalk.gray('4. Copia el token que te da (se ve así: 123456:ABC-DEF...)\n'));

    const tokenAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'Pega tu token aquí:',
        mask: '*',
        validate: (input) => {
          if (!input.trim()) return 'El token no puede estar vacío';
          if (!TOKEN_REGEX.test(input.trim())) {
            return 'Formato de token inválido. Debe ser: 123456:ABC-DEF...';
          }
          return true;
        },
      },
    ]);

    console.log('\n');
    console.log(chalk.white('Ahora necesito tu ID de Telegram.\n'));
    console.log(chalk.gray('Para saber tu ID:'));
    console.log(chalk.gray('1. Busca @userinfobot en Telegram'));
    console.log(chalk.gray('2. Escríbele cualquier cosa'));
    console.log(chalk.gray('3. Te responderá con tu ID numérico\n'));

    const userIdAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'userId',
        message: '¿Cuál es tu ID de Telegram?',
        validate: (input) => {
          if (!input.trim()) return 'El ID no puede estar vacío';
          if (!/^\d+$/.test(input.trim())) {
            return 'El ID debe ser un número';
          }
          return true;
        },
      },
    ]);

    return {
      success: true,
      data: {
        token: tokenAnswers.token.trim(),
        userId: userIdAnswers.userId.trim(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Error configurando Telegram: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
