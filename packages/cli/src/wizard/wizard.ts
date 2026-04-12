import chalk from 'chalk';
import { welcome } from './steps/welcome.js';
import { configureOllama } from './steps/configureOllama.js';
import { checkOllama } from './steps/checkOllama.js';
import { selectModel } from './steps/selectModel.js';
import { setupTelegram } from './steps/setupTelegram.js';
import { setPersonality } from './steps/setPersonality.js';
import { finish, WizardState } from './steps/finish.js';
import { configExists } from '../utils/config.js';
import inquirer from 'inquirer';

export interface WizardResult {
  success: boolean;
  startNow?: boolean;
  error?: string;
}

export async function runWizard(): Promise<WizardResult> {
  try {
    // Check if config already exists
    if (configExists()) {
      console.log('\n');
      console.log(chalk.yellow('⚠️  Ya existe una configuración.\n'));

      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: '¿Qué quieres hacer?',
          choices: [
            { name: 'Sobreescribir (comenzar desde cero)', value: 'overwrite' },
            { name: 'Mantener la actual', value: 'keep' },
          ],
        },
      ]);

      if (answers.action === 'keep') {
        const startAnswer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'startNow',
            message: '¿Quieres iniciar Enzo ahora con la configuración actual?',
            default: false,
          },
        ]);

        console.log(chalk.green('\n✅ Usando configuración existente.\n'));
        return { success: true, startNow: Boolean(startAnswer.startNow) };
      }
    }

    const state: Partial<WizardState> = {};

    // Step 1: Welcome
    console.log('\n');
    const welcomeResult = await welcome();
    if (!welcomeResult.success) {
      return { success: false, error: welcomeResult.error };
    }
    state.userName = welcomeResult.data?.userName || 'Usuario';

    // Step 2: Configure Ollama URL
    const configOllamaResult = await configureOllama();
    if (!configOllamaResult.success) {
      return { success: false, error: configOllamaResult.error };
    }
    state.ollamaBaseUrl = configOllamaResult.data?.baseUrl || 'http://localhost:11434';

    // Step 3: Check Ollama
    const ollamaResult = await checkOllama(state.ollamaBaseUrl);
    if (!ollamaResult.success) {
      return { success: false, error: ollamaResult.error };
    }

    // Step 4: Select Model
    const modelResult = await selectModel(state.ollamaBaseUrl);
    if (!modelResult.success) {
      return { success: false, error: modelResult.error };
    }
    state.model = modelResult.data?.model || 'qwen2.5:7b';

    // Step 5: Setup Telegram
    const telegramResult = await setupTelegram();
    if (!telegramResult.success) {
      return { success: false, error: telegramResult.error };
    }
    state.telegramToken = telegramResult.data?.token;
    state.telegramUserId = telegramResult.data?.userId;

    // Step 6: Set Personality
    const personalityResult = await setPersonality();
    if (!personalityResult.success) {
      return { success: false, error: personalityResult.error };
    }
    state.assistantName = personalityResult.data?.name || 'Enzo';
    state.tone = personalityResult.data?.tone || 'informal';

    // Step 7: Finish
    const finishResult = await finish(state as WizardState);
    if (!finishResult.success) {
      return { success: false, error: finishResult.error };
    }

    return { success: true, startNow: finishResult.startNow ?? false };
  } catch (error) {
    return {
      success: false,
      error: `Error en wizard: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
