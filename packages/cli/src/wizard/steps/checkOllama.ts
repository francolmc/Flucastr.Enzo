import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { checkOllamaRunning } from '../../utils/ollama.js';

export interface CheckOllamaResult {
  success: boolean;
  error?: string;
}

export async function checkOllama(baseUrl: string = 'http://localhost:11434'): Promise<CheckOllamaResult> {
  try {
    const spinner = ora(chalk.blue('Verificando que Ollama esté instalado...')).start();

    const isRunning = await checkOllamaRunning(baseUrl);

    if (isRunning) {
      spinner.succeed(chalk.green('✅ Ollama está corriendo'));
      return { success: true };
    }

    spinner.fail(chalk.red('❌ Ollama no está corriendo'));

    console.log('\n');
    console.log(chalk.yellow('Ollama es el programa que permite a Enzo pensar'));
    console.log(chalk.yellow('sin necesidad de internet.\n'));

    console.log(chalk.white('¿Qué necesitas hacer?'));
    console.log(chalk.gray('→ Si no tienes Ollama: ve a https://ollama.ai y descárgalo'));
    console.log(chalk.gray('→ Si ya lo tienes: ábrelo y vuelve a ejecutar "pnpm exec enzo setup"\n'));

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'retry',
        message: '¿Ya lo tienes abierto?',
        default: false,
      },
    ]);

    if (answers.retry) {
      return checkOllama();
    }

    return {
      success: false,
      error: 'Ollama no está disponible. Por favor instálalo y vuelve a intentar.',
    };
  } catch (error) {
    return {
      success: false,
      error: `Error verificando Ollama: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
