import { Telegraf } from 'telegraf';
import { createModelClient } from '../../core/src/model/client.js';
import { createMemory } from '../../core/src/memory/memory.js';
import { createPlanner } from '../../core/src/planner/planner.js';
import { createMcpRegistry } from '../../core/src/mcp/registry.js';
import { loadConfig } from '../../core/src/config.js';
import { createConversationMemory } from '../../core/src/memory/conversation.js';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

async function transcribeAudio(filePath: string): Promise<string> {
  const whisperCommands = [
    'whisper',
    '/usr/local/bin/whisper',
    '/opt/homebrew/bin/whisper',
    '/Users/franco/Library/Python/3.9/bin/whisper',
    'python -m whisper',
    'python3 -m whisper',
  ];

  const txtDir = '/tmp';
  const baseName = path.basename(filePath, path.extname(filePath));
  const txtPath = path.join(txtDir, `${baseName}.txt`);

  for (const cmd of whisperCommands) {
    try {
      const fullCmd = cmd.includes('whisper')
        ? `${cmd} "${filePath}" --model tiny --language es --output_format txt --output_dir ${txtDir}`
        : `${cmd} "${filePath}" --model tiny --language Spanish --output_dir ${txtDir}`;

      await execAsync(fullCmd, { timeout: 120000 });

      if (fs.existsSync(txtPath)) {
        const text = fs.readFileSync(txtPath, 'utf-8').trim();
        fs.unlinkSync(txtPath);
        return text;
      }
    } catch {}
  }

  throw new Error('Whisper not found. Install with: pip install openai-whisper or brew install whisper.cpp');
}

async function downloadTelegramFile(ctx: any, fileId: string): Promise<string> {
  const file = await ctx.telegram.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;

  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();

  const tmpPath = path.join(os.tmpdir(), `enzo_audio_${Date.now()}.ogg`);
  fs.writeFileSync(tmpPath, Buffer.from(buffer));

  return tmpPath;
}

async function textToSpeech(text: string): Promise<string | null> {
  const audioPath = path.join(os.tmpdir(), `enzo_response_${Date.now()}.mp3`);
  const escapedText = text.replace(/"/g, "'").replace(/\n/g, ' ');

  const ttsCommands = [
    'edge-tts',
    '/usr/local/bin/edge-tts',
    '/opt/homebrew/bin/edge-tts',
    'python -m edge_tts',
    'python3 -m edge_tts',
  ];

  const voices = ['es-CL-CatalinaNeural', 'es-ES-AlvaroNeural', 'es-MX-DaliaNeural'];

  for (const cmd of ttsCommands) {
    for (const voice of voices) {
      try {
        await execAsync(
          `${cmd} --voice "${voice}" --text "${escapedText}" --write-media "${audioPath}"`,
          { timeout: 30000 }
        );
        if (fs.existsSync(audioPath)) {
          return audioPath;
        }
      } catch {}
    }
  }

  return null;
}

const config = loadConfig();
const memory = createMemory(config);
const model = createModelClient(config);
const mcpRegistry = await createMcpRegistry(config.mcpServers, memory);
const planner = createPlanner(model, memory, mcpRegistry);
const conversationMemory = createConversationMemory();

const USER_ID = config.telegramOwnerId ?? 'franco';

memory.saveFact(USER_ID, 'name', 'Franco');
  memory.saveFact(USER_ID, 'home', os.homedir());
  memory.saveFact(USER_ID, 'tasks_file', `${os.homedir()}/tareas.md`);
  memory.saveFact(USER_ID, 'assistant_description', 
  'Enzo is a personal AI assistant built to help Franco with daily tasks, web search, file management, and automation. Enzo runs on small local models using the Amplify architecture.');

export function createBot(token: string) {
  const bot = new Telegraf(token);

  bot.on('text', async (ctx) => {
    const userId = String(ctx.from.id);

    if (userId !== config.telegramOwnerId) return;

    const userMessage = ctx.message.text;
    await ctx.sendChatAction('typing');

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 5000);

    try {
      const contextForUnderstand = conversationMemory.getRelevantForUnderstand(userMessage);
      const contextForPlan = conversationMemory.getRelevant(userMessage);

      const response = await Promise.race([
        planner.resolve(userMessage, USER_ID, contextForPlan, false, contextForUnderstand),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 120000)
        )
      ]);

      clearInterval(typingInterval);
      conversationMemory.save(userMessage, response);
      await ctx.reply(response.slice(0, 4000));

    } catch (error: any) {
      clearInterval(typingInterval);
      if (error.message === 'timeout') {
        await ctx.reply('La tarea tomó demasiado tiempo. Intenta con algo más específico.');
      } else {
        await ctx.reply('Ocurrió un error. Intenta de nuevo.');
        console.error('[telegram error]:', error);
      }
    }
  });

  bot.on('voice', async (ctx) => {
    const userId = String(ctx.from.id);
    if (userId !== config.telegramOwnerId) return;

    await ctx.sendChatAction('typing');

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 5000);

    try {
      const audioPath = await downloadTelegramFile(ctx, ctx.message.voice.file_id);

      await ctx.sendChatAction('typing');
      const userMessage = await transcribeAudio(audioPath);
      fs.unlinkSync(audioPath);

      if (!userMessage) {
        clearInterval(typingInterval);
        await ctx.reply('No pude entender el audio. Intenta de nuevo.');
        return;
      }

      const contextForUnderstand = conversationMemory.getRelevantForUnderstand(userMessage);
      const contextForPlan = conversationMemory.getRelevant(userMessage);

      const response = await Promise.race([
        planner.resolve(userMessage, USER_ID, contextForPlan, true, contextForUnderstand),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 120000)
        )
      ]);

      clearInterval(typingInterval);
      conversationMemory.save(userMessage, response);
      await ctx.sendChatAction('record_voice');
      const responseAudio = await textToSpeech(response);

      if (responseAudio) {
        await ctx.replyWithVoice({ source: responseAudio });
        fs.unlinkSync(responseAudio);
      } else {
        await ctx.reply(`🎤 "${userMessage}"\n\n${response}`);
      }

    } catch (error: any) {
      clearInterval(typingInterval);
      if (error.message === 'timeout') {
        await ctx.reply('La tarea tomó demasiado tiempo. Intenta con algo más específico.');
      } else {
        console.error('[voice error]:', error);
        await ctx.reply('Error procesando el audio.');
      }
    }
  });

  bot.catch((err: any) => {
    console.error('[bot error]:', err.message);
  });

  return bot;
}