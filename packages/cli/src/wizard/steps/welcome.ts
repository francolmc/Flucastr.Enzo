import chalk from 'chalk';
import inquirer from 'inquirer';

export interface WelcomeResult {
  success: boolean;
  data?: { userName: string };
  error?: string;
}

export async function welcome(): Promise<WelcomeResult> {
  try {
    console.log('\n');
    console.log(chalk.cyan('╔═══════════════════════════════╗'));
    console.log(chalk.cyan('║   🦊 Bienvenido a Enzo        ║'));
    console.log(chalk.cyan('║   Tu asistente personal       ║'));
    console.log(chalk.cyan('╚═══════════════════════════════╝'));
    console.log('\n');
    console.log(chalk.white('Vamos a configurar todo en unos minutos.'));
    console.log(chalk.white('Solo necesito hacerte algunas preguntas.\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'userName',
        message: '¿Cuál es tu nombre?',
        default: 'Usuario',
        validate: (input) => input.trim().length > 0 || 'Por favor ingresa un nombre',
      },
    ]);

    return {
      success: true,
      data: { userName: answers.userName },
    };
  } catch (error) {
    return {
      success: false,
      error: `Error en bienvenida: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
