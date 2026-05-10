export interface VisionResult {
  success: boolean;
  description?: string;
  canRetry?: boolean;
  error?: string;
}

export interface VisionService {
  analyze(imageBuffer: Buffer, mimeType: string, prompt?: string): Promise<VisionResult>;
}
