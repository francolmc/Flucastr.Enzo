import { resolveEnzoScriptPath, scheduleEnzoSupervisorRestart } from '@enzo/core';
import { Telegraf } from 'telegraf';
import type { EnzoContext } from '../bot.js';
import { startTyping } from '../typing.js';
import { spawn } from 'child_process';
import {
  clearCurrentConversation,
  getCurrentConversationId,
  startNewConversation,
} from './conversationState.js';
import type { Command } from '@enzo/sdk';

let updateInProgress = false;

function getConversationId(userId: string): string {
  return getCurrentConversationId(userId);
}

function stripAgentCommandPrefix(rawText: string): string {
  return rawText.replace(/^\/(agent|agents)(@\w+)?/i, '').trim();
}

async function getAgentsForTelegramUser(ctx: EnzoContext, userId: string) {
  // SDK Mode: Use API to list agents
  if (ctx.apiClient) {
    try {
      const agents = await ctx.apiClient.commands.execute('agent.list', [], userId);
      return agents.data?.agents || [];
    } catch (error) {
      console.warn('[Telegram] Failed to list agents via API:', error);
      return [];
    }
  }
  return [];
}

async function executeAgentCommand(ctx: EnzoContext, messageText: string): Promise<void> {
  const userId = String(ctx.from?.id || '');
  const rawArg = stripAgentCommandPrefix(messageText || '');
  const typingSession = startTyping(ctx);

  if (!ctx.apiClient) {
    await ctx.reply('❌ Error: API client not configured.');
    typingSession.stop();
    return;
  }

  try {
    if (!rawArg) {
      // List available agents
      const result = await ctx.apiClient.commands.execute('agent.list', [], userId);
      const agents = result.data?.agents || [];
      
      if (agents.length === 0) {
        await ctx.reply('No hay agentes disponibles. Crea uno en la Web UI primero.');
        return;
      }
      
      const agentsList = agents.map((agent: any) => `- ${agent.name} (${agent.provider}/${agent.model})`).join('\n');
      await ctx.reply(
        `Presets disponibles:\n${agentsList}\n\nUsa \`/agent <name>\` para activar.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const normalizedArg = rawArg.toLowerCase();
    if (normalizedArg === 'off' || normalizedArg === 'none' || normalizedArg === 'default') {
      await ctx.apiClient.commands.execute('agent.set', ['off'], userId);
      await ctx.reply('Preset conversacional desactivado.');
      return;
    }

    // Set active agent
    const result = await ctx.apiClient.commands.execute('agent.set', [rawArg], userId);
    if (result.success) {
      await ctx.reply(`✅ ${result.message || 'Agente configurado'}`);
    } else {
      await ctx.reply(`❌ ${result.message || 'No se pudo configurar el agente'}`);
    }
  } catch (error) {
    console.error('[Telegram] Error processing /agent command:', error);
    await ctx.reply('❌ Error al configurar el agente.');
  } finally {
    typingSession.stop();
  }
}

/**
 * When Telegraf does not match `/agent` (missing bot_command entity, etc.), handle from the text handler.
 */
export async function tryHandleAgentCommandText(ctx: EnzoContext, messageText: string): Promise<boolean> {
  if (!/^\s*\/(agent|agents)\b/i.test(messageText)) {
    return false;
  }
  await executeAgentCommand(ctx, messageText);
  return true;
}

function isOwner(userId: string): boolean {
  const ownerUserId = process.env.TELEGRAM_AGENT_OWNER_USER_ID?.trim();
  return Boolean(ownerUserId && ownerUserId === userId);
}

async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string = process.cwd()
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });

    child.on('exit', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runStep(
  ctx: EnzoContext,
  title: string,
  command: string,
  args: string[],
  cwd: string = process.cwd()
): Promise<void> {
  await ctx.reply(`• ${title}`);
  const result = await runCommandCapture(command, args, cwd);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || 'Sin detalle').trim().slice(0, 1200);
    throw new Error(`${title} falló.\n${detail}`);
  }
}

export function registerCommands(bot: Telegraf<EnzoContext>): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '*Comandos disponibles:*',
        '- `/start` - saludo inicial',
        '- `/help` - ver esta ayuda',
        '- `/new` - iniciar conversación nueva',
        '- `/clear` - limpiar historial de conversación',
        '- `/memory` - ver memorias guardadas',
        '- `/agent` o `/agents` - listar o configurar agente por conversación',
        '- `/update` - actualizar Enzo y disparar reinicio externo (solo admin; requiere ENZO_UPDATE_RESTART_CMD)',
        '',
        'Ejemplos de agente:',
        '- `/agent` o `/agents`',
        '- `/agent research`',
        '- `/agent off`',
        '',
        'Por defecto el modelo especialista solo se usa si lo activas con `/agent nombre`; `/agent off` vuelve al modelo principal.',
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '¡Hola! Soy Enzo 🦊 Tu asistente personal.\nEscríbeme lo que necesitas y lo resuelvo.\n\nUsa `/help` para ver los comandos disponibles.',
      {
        parse_mode: 'Markdown',
      }
    );
  });

  bot.command('new', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    
    if (!ctx.apiClient) {
      await ctx.reply('❌ Error: API client not configured. Please contact administrator.');
      return;
    }
    
    try {
      const result = await ctx.apiClient.commands.execute('chat.new', [], userId);
      if (result.success) {
        // Sync local state
        const conversationId = startNewConversation(userId);
        await ctx.reply(result.message || 'Nueva conversación iniciada. ¿En qué te ayudo?', {
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.reply('❌ Error: ' + result.message);
      }
    } catch (error) {
      console.error('[Telegram] /new command failed:', error);
      await ctx.reply('❌ Error al iniciar conversación. Inténtalo de nuevo.');
    }
  });

  bot.command('clear', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const conversationId = getCurrentConversationId(userId);
    const typingSession = startTyping(ctx);

    if (!ctx.apiClient) {
      await ctx.reply('❌ Error: API client not configured.');
      typingSession.stop();
      return;
    }

    try {
      const result = await ctx.apiClient.commands.execute('chat.clear', [], userId);
      if (result.success) {
        clearCurrentConversation(userId);
        await ctx.reply(result.message || '✅ Historial de conversación limpiado. Empecemos de nuevo.', {
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.reply('❌ Error: ' + result.message);
      }
    } catch (error) {
      console.error('[Telegram] /clear command failed:', error);
      await ctx.reply('❌ Error al limpiar el historial. Inténtalo de nuevo.');
    } finally {
      typingSession.stop();
    }
  });

  bot.command('memory', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const typingSession = startTyping(ctx);
    
    if (!ctx.apiClient) {
      await ctx.reply('❌ Error: API client not configured.');
      typingSession.stop();
      return;
    }
    
    try {
      console.log(`[Telegram] /memory command - userId: ${userId}`);
      
      const memories = await ctx.apiClient.memory.recall(userId);
      console.log(`[Telegram] /memory via API - Retrieved ${memories?.length || 0} memories`);
      
      if (!memories || memories.length === 0) {
        await ctx.reply('No tienes memorias guardadas aún.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      const memoriesList = memories
        .map((m, i) => `${i + 1}. *${m.key}*: ${m.value}`)
        .join('\n');

      // Split if too long
      if (memoriesList.length > 4096) {
        const chunks = memoriesList.match(/[\s\S]{1,4000}/g) || [];
        for (const chunk of chunks) {
          await ctx.reply(`_Memorias guardadas:_\n\n${chunk}`, {
            parse_mode: 'Markdown',
          });
        }
      } else {
        await ctx.reply(`_Memorias guardadas:_\n\n${memoriesList}`, {
          parse_mode: 'Markdown',
        });
      }
    } catch (error) {
      console.error('[Telegram] /memory command failed:', error);
      await ctx.reply('❌ Error al recuperar memorias. Inténtalo de nuevo.');
    } finally {
      typingSession.stop();
    }
  });

  bot.command('agent', async (ctx) => {
    const messageText = 'text' in ctx.message ? ctx.message.text : '';
    await executeAgentCommand(ctx, messageText || '');
  });

  bot.command('agents', async (ctx) => {
    const messageText = 'text' in ctx.message ? ctx.message.text : '';
    await executeAgentCommand(ctx, messageText || '');
  });

  bot.command('update', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const typingSession = startTyping(ctx);
    let lockHeld = false;

    try {
      if (!isOwner(userId)) {
        await ctx.reply('No tienes permisos para ejecutar `/update`.', { parse_mode: 'Markdown' });
        return;
      }

      if (updateInProgress) {
        await ctx.reply('Ya hay una actualización en progreso. Espera a que termine.');
        return;
      }

      updateInProgress = true;
      lockHeld = true;
      await ctx.reply('🔄 Iniciando actualización de Enzo...');

      const repoCheck = await runCommandCapture('git', ['rev-parse', '--is-inside-work-tree']);
      if (repoCheck.code !== 0 || !repoCheck.stdout.includes('true')) {
        throw new Error('No estoy corriendo dentro de un repositorio Git válido.');
      }
      const repoRootResult = await runCommandCapture('git', ['rev-parse', '--show-toplevel']);
      if (repoRootResult.code !== 0 || !repoRootResult.stdout.trim()) {
        throw new Error('No pude resolver la raíz del repositorio para ejecutar ./enzo.');
      }
      const repoRoot = repoRootResult.stdout.trim();

      const dirtyCheck = await runCommandCapture('git', ['status', '--porcelain'], repoRoot);
      if (dirtyCheck.code !== 0) {
        throw new Error('No pude verificar cambios locales antes de actualizar.');
      }

      if (dirtyCheck.stdout.trim().length > 0) {
        await ctx.reply(
          '⚠️ Hay cambios locales sin commit. Cancelo la actualización para evitar conflictos.\n\n' +
            'Haz commit/stash primero y vuelve a ejecutar `/update`.'
        );
        return;
      }

      await runStep(
        ctx,
        'Sincronizando cambios remotos (`git pull --ff-only`)...',
        'git',
        ['pull', '--ff-only'],
        repoRoot
      );
      await runStep(ctx, 'Instalando dependencias (`pnpm install`)...', 'pnpm', ['install'], repoRoot);
      await runStep(ctx, 'Compilando paquetes (`pnpm build`)...', 'pnpm', ['build'], repoRoot);
      await runStep(ctx, 'Verificando configuración (`./enzo status`)...', resolveEnzoScriptPath(repoRoot), [
        'status',
      ], repoRoot);

      const restart = scheduleEnzoSupervisorRestart({ cwd: repoRoot });
      const restartLine =
        restart.kind === 'skipped'
          ? `⚠️ ${restart.userMessage}`
          : `🔄 ${restart.userMessage}`;

      await ctx.reply(
        `✅ Código actualizado, dependencias y build listos.\n\n${restartLine}`
      );
    } catch (error) {
      console.error('[Telegram] Error running /update:', error);
      const detail = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ Falló la actualización:\n${detail}`);
    } finally {
      if (lockHeld) {
        updateInProgress = false;
      }
      typingSession.stop();
    }
  });
}
