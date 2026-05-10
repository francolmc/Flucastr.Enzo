/**
 * Telegram API Client - Wrapper around @enzo/sdk
 * 
 * This module provides a simplified interface for Telegram handlers
 * to communicate with the Enzo API via the SDK.
 */

import { EnzoApiClient } from '@enzo/sdk';

const DEFAULT_API_URL = 'http://localhost:3001';

export interface TelegramApiClientConfig {
  apiUrl?: string;
  apiKey?: string;
}

/**
 * Create an API client for Telegram handlers
 */
export function createTelegramApiClient(config?: TelegramApiClientConfig): EnzoApiClient {
  const apiUrl = config?.apiUrl || process.env.ENZO_API_URL || DEFAULT_API_URL;
  const apiKey = config?.apiKey || process.env.ENZO_API_KEY;

  console.log(`[Telegram] API client configured for: ${apiUrl}`);
  
  return new EnzoApiClient({
    baseUrl: apiUrl,
    apiKey,
    timeout: 90000,
  });
}

export { EnzoApiClient };
export type { 
  ChatOptions, 
  ChatResponse, 
  StreamEvent,
  ClassificationResult,
  Command,
  CommandResult,
  FileUploadResult,
  TranscriptionResult,
  SynthesisResult,
  Memory,
} from '@enzo/sdk';
