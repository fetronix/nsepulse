import { config } from '../config.js';
import { startTelegramBot } from './bot.js';
if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required to start the standalone bot process.');
await startTelegramBot(config.TELEGRAM_BOT_TOKEN);
