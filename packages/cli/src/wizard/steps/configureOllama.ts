import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { checkOllamaRunning } from '../../utils/ollama.js';

export interface ConfigureOllamaResult {
  success: boolean;
  data?: { baseUrl: string };
  error?: string;
}

const URL_REGEX = /^https?:\/\/.+:\d+$/;

export async function configureOllama(): Promise<ConfigureOllamaResult> {
  try {
    console.log('\n');
    console.log(chalk.cyan('🔧 Configurar servidor Ollama\n'));

    console.log(chalk.white('¿Dónde está corriendo tu servidor Ollama?\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'URL del servidor Ollama',
        default: 'http://localhost:11434',
        validate: async (input: string) => {
          const url = input.trim();

          if (!url) {
            return 'La URL no puede estar vacía';
          }

          // Basic URL validation
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return 'La URL debe comenzar con http:// o https://';
          }

          // Check if URL is valid
          const spinner = ora(chalk.blue(`Verificando conexión a ${url}...`)).start();

          try {
            const isRunning = await checkOllamaRunning(url);

            if (isRunning) {
              spinner.succeed(chalk.green(`✅ Conexión exitosa a ${url}`));
              return true;
            } else {
              spinner.fail(chalk.red(`❌ No se puede conectar a ${url}`));
              return `No se puede conectar a ${url}. Verifica que Ollama esté corriendo.`;
            }
          } catch (error) {
            spinner.fail(chalk.red(`❌ Error conectando a ${url}`));
            return `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
    ]);

    return {
      success: true,
      data: { baseUrl: answers.baseUrl.trim() },
    };
  } catch (error) {
    return {
      success: false,
      error: `Error configurando Ollama: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
