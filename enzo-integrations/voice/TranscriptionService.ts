export interface TranscriptionResult {
  success: boolean;
  text?: string;
  language?: string;
  durationSeconds?: number;
  error?: string;
}

export interface TranscriptionService {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult>;
}
