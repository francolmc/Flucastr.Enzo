import fs from 'fs';
import path from 'path';
import os from 'os';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
}

export interface ConfigService {
  ollamaBaseUrl: string;
  primaryModel: string;
  dbPath: string;
  telegramBotToken?: string;
  telegramOwnerId?: string;
  mcpServers: McpServerConfig[];
}

export function loadConfig(): ConfigService {
  const configPath = path.join(os.homedir(), '.enzo', 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  return {
    ollamaBaseUrl: raw.system?.ollamaBaseUrl ?? 'http://localhost:11434',
    primaryModel: raw.primaryModel ?? 'qwen3:4b-instruct',
    dbPath: raw.system?.dbPath ?? path.join(os.homedir(), 'enzo.db'),
    telegramBotToken: raw.telegramBotToken,
    telegramOwnerId: raw.telegramOwnerId,
    mcpServers: raw.mcpServers ?? [],
  };
}