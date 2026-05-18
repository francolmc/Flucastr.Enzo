import { loadConfig } from '../../core/src/config.js';
import { createBot } from './bot.js';

const config = loadConfig();
const token = config.telegramBotToken;
if (!token) throw new Error('telegramBotToken not set in ~/.enzo/config.json');

const bot = createBot(token);
bot.launch();
console.log('🦊 Enzo Telegram activo');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));