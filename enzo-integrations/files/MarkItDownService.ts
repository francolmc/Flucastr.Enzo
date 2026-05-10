export interface ConversionResult {
  success: boolean;
  markdown?: string;
  title?: string;
  pageCount?: number;
  error?: string;
}

export interface MarkItDownService {
  convert(filePath: string): Promise<ConversionResult>;
  isSupported(extension: string): boolean;
}
