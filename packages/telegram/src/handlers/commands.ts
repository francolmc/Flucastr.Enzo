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

let updateInProgress = false;

function getConversationId(userId: string): string {
  return getCurrentConversationId(userId);
}

function stripAgentCommandPrefix(rawText: string): string {
  return rawText.replace(/^\/(agent|agents)(@\w+)?/i, '').trim();
}

async function getAgentsForTelegramUser(ctx: EnzoContext, userId: string) {
  const ownAgents = await ctx.memoryService.getAgents(userId);
  if (ownAgents.length > 0) {
    return ownAgents;
  }

  const ownerUserId = process.env.TELEGRAM_AGENT_OWNER_USER_ID?.trim();
  if (ownerUserId && ownerUserId !== userId) {
    const ownerAgents = await ctx.memoryService.getAgents(ownerUserId);
    if (ownerAgents.length > 0) {
      return ownerAgents;
    }
  }

  return ctx.memoryService.getAllAgents();
}

async function executeAgentCommand(ctx: EnzoContext, messageText: string): Promise<void> {
  const userId = String(ctx.from?.id || '');
  const conversationId = getConversationId(userId);
  const rawArg = stripAgentCommandPrefix(messageText || '');
  const typingSession = startTyping(ctx);

  try {
    const agents = await getAgentsForTelegramUser(ctx, userId);
    if (agents.length === 0) {
      await ctx.reply('No hay agentes disponibles. Crea uno en la Web UI primero.');
      return;
    }

    if (!rawArg) {
      const activeAgentId = await ctx.memoryService.getConversationActiveAgent(conversationId);
      const activeAgent = activeAgentId
        ? agents.find((agent) => agent.id === activeAgentId)
        : undefined;
      const agentsList = agents.map((agent) => `- ${agent.name} (${agent.provider}/${agent.model})`).join('\n');
      const activeLine = activeAgent
        ? `Activo en esta conversación: *${activeAgent.name}*`
        : 'No hay agente activo en esta conversación.';
      await ctx.reply(
        `${activeLine}\n\nAgentes disponibles:\n${agentsList}\n\nUsa \`/agent <name>\` para activar o \`/agent off\` para desactivar.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const normalizedArg = rawArg.toLowerCase();
    if (normalizedArg === 'off' || normalizedArg === 'none' || normalizedArg === 'default') {
      await ctx.memoryService.setConversationActiveAgent(conversationId, userId, undefined);
      await ctx.reply('Modo agente desactivado para esta conversación. Volvemos al modelo principal.');
      return;
    }

    const selectedAgent = agents.find((agent) => {
      const candidateName = agent.name.toLowerCase();
      return candidateName === normalizedArg || candidateName.includes(normalizedArg);
    });

    if (!selectedAgent) {
      await ctx.reply(`No encontré un agente llamado "${rawArg}". Usa \`/agent\` para ver la lista.`);
      return;
    }

    await ctx.memoryService.setConversationActiveAgent(conversationId, userId, selectedAgent.id);
    await ctx.reply(
      `Agente *${selectedAgent.name}* activado para esta conversación.\nModelo: \`${selectedAgent.provider}/${selectedAgent.model}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('[Telegram] Error processing /agent command:', error);
    await ctx.reply('Error al configurar el agente.');
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
    const conversationId = startNewConversation(userId);
    await ctx.memoryService.setConversationActiveAgent(conversationId, userId, undefined);

    await ctx.reply('Nueva conversación iniciada. ¿En qué te ayudo?', {
      parse_mode: 'Markdown',
    });
  });

  bot.command('clear', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const conversationId = getCurrentConversationId(userId);
    const typingSession = startTyping(ctx);

    try {
      await ctx.memoryService.resetConversationContext(conversationId, userId);
      clearCurrentConversation(userId);

      await ctx.reply('✅ Historial de conversación limpiado. Empecemos de nuevo.', {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      console.error('[Telegram] Error clearing history:', error);
      await ctx.reply('Error al limpiar el historial.', {
        parse_mode: 'Markdown',
      });
    } finally {
      typingSession.stop();
    }
  });

  bot.command('memory', async (ctx) => {
    const userId = String(ctx.from?.id || '');
    const typingSession = startTyping(ctx);
    try {
      console.log(`[Telegram] /memory command - userId: ${userId}`);
      const memories = await (ctx.memoryService as any).recall(userId);
      
      console.log(`[Telegram] /memory - Retrieved ${memories?.length || 0} memories for userId ${userId}`);
      if (memories && memories.length > 0) {
        console.log(`[Telegram] /memory - Memories:`, memories);
      }
      
      if (!memories || memories.length === 0) {
        await ctx.reply('No tienes memorias guardadas aún.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      const memoriesList = memories
        .map((m: any, i: number) => `${i + 1}. *${m.key}*: ${m.value}`)
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
      console.error('[Telegram] Error fetching memories:', error);
      await ctx.reply('Error al recuperar memorias.', {
        parse_mode: 'Markdown',
      });
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
