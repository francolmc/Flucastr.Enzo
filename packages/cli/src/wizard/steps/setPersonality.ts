import chalk from 'chalk';
import inquirer from 'inquirer';

export interface SetPersonalityResult {
  success: boolean;
  data?: { name: string; tone: string };
  error?: string;
}

export async function setPersonality(): Promise<SetPersonalityResult> {
  try {
    console.log('\n');
    console.log(chalk.cyan('🦊 Personaliza a Enzo\n'));

    const nameAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: '¿Cómo quieres que se llame tu asistente?',
        default: 'Enzo',
        validate: (input: string) => input.trim().length > 0 || 'El nombre no puede estar vacío',
      },
    ]);

    console.log('\n');
    console.log(chalk.white('¿Cómo quieres que te hable?\n'));

    const toneAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'tone',
        message: 'Selecciona el tono de voz:',
        choices: [
          {
            name: '1. Informal y cercano ("¡Hola! ¿Cómo vas?")',
            value: 'informal',
          },
          {
            name: '2. Formal y profesional ("Buenos días. ¿En qué le puedo ayudar?")',
            value: 'formal',
          },
          {
            name: '3. Directo y conciso ("Listo. ¿Qué más?")',
            value: 'direct',
          },
        ],
        default: 'informal',
      },
    ]);

    return {
      success: true,
      data: {
        name: nameAnswers.name.trim(),
        tone: toneAnswers.tone,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Error personalizando Enzo: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
