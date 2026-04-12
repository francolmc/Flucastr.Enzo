import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { listModels, pullModel, formatBytes } from '../../utils/ollama.js';

export interface SelectModelResult {
  success: boolean;
  data?: { model: string };
  error?: string;
}

export async function selectModel(baseUrl: string = 'http://localhost:11434'): Promise<SelectModelResult> {
  try {
    const spinner = ora(chalk.blue('Buscando modelos disponibles...')).start();

    const models = await listModels(baseUrl);

    if (models.length === 0) {
      spinner.warn(chalk.yellow('⚠️  No tienes modelos instalados todavía'));

      console.log('\n');
      console.log(chalk.white('Te recomiendo qwen2.5:7b — es el mejor balance'));
      console.log(chalk.white('entre capacidad y velocidad.\n'));

      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'download',
          message: '¿Quieres que lo descargue ahora? (puede tardar unos minutos)',
          default: true,
        },
      ]);

      if (answers.download) {
        const downloadSpinner = ora(chalk.blue('Descargando qwen2.5:7b...')).start();

        try {
          await pullModel('qwen2.5:7b', baseUrl, (status) => {
            downloadSpinner.text = chalk.blue(`Descargando qwen2.5:7b... ${status}`);
          });

          downloadSpinner.succeed(chalk.green('✅ qwen2.5:7b descargado'));
          return { success: true, data: { model: 'qwen2.5:7b' } };
        } catch (error) {
          downloadSpinner.fail(chalk.red('❌ Error descargando modelo'));
          return {
            success: false,
            error: `Error descargando modelo: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: 'No hay modelos disponibles. Por favor descarga uno primero.',
      };
    }

    spinner.succeed(chalk.green(`✅ Encontré ${models.length} modelo(s)`));

    console.log('\n');
    console.log(chalk.white('✅ Encontré estos modelos instalados:\n'));

    const choices = models.map((model, index) => ({
      name: `${index + 1}. ${model.name}${
        model.name === 'qwen2.5:7b' ? ' (recomendado)' : ''
      } - ${formatBytes(model.size)}`,
      value: model.name,
    }));

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'model',
        message: '¿Cuál quieres usar como modelo principal?',
        choices,
        default: 'qwen2.5:7b',
      },
    ]);

    return { success: true, data: { model: answers.model } };
  } catch (error) {
    return {
      success: false,
      error: `Error seleccionando modelo: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
