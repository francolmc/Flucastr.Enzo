export interface TTSResult {
  success: boolean;
  audioBuffer?: Buffer;
  mimeType?: string; // audio/ogg for Telegram voice messages
  error?: string;
}

export interface TTSService {
  synthesize(text: string, language: string): Promise<TTSResult>;
}
