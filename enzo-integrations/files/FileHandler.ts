import { existsSync } from 'fs';
import { mkdir, writeFile, readFile, access, constants as fsConstants } from 'fs/promises';
import path from 'path';

export interface ReceivedFile {
  originalName: string;
  /** Absolute path where the file was saved */
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  extension: string;
}

export interface FileHandlerOptions {
  workspacePath: string;
  /** Default 50 MiB */
  maxSizeMb?: number;
}

function todayUploadSubdir(now = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pickUniqueFilename(destDir: string, originalName: string): string {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  let candidate = originalName;
  let k = 0;
  while (existsSync(path.join(destDir, candidate))) {
    k += 1;
    candidate = `${base}_${k}${ext}`;
  }
  return candidate;
}

export class FileHandler {
  private readonly workspacePath: string;
  private readonly maxSizeBytes: number;

  constructor(options: FileHandlerOptions) {
    this.workspacePath = path.resolve(options.workspacePath);
    const mb = options.maxSizeMb ?? 50;
    this.maxSizeBytes = mb * 1024 * 1024;
  }

  async save(buffer: Buffer, originalName: string, mimeType: string): Promise<ReceivedFile> {
    const sizeBytes = buffer.length;
    const maxMb = this.maxSizeBytes / (1024 * 1024);
    if (sizeBytes > this.maxSizeBytes) {
      throw new Error(
        `El archivo supera el tamaño máximo permitido (${maxMb.toFixed(0)}MB); recibidos ${(
          sizeBytes /
          (1024 * 1024)
        ).toFixed(2)}MB`
      );
    }

    const safeName = originalName.trim() || 'unnamed.bin';
    const uploadDir = path.join(this.workspacePath, 'uploads', todayUploadSubdir());
    await mkdir(uploadDir, { recursive: true });

    const filename = pickUniqueFilename(uploadDir, safeName);
    const localPath = path.join(uploadDir, filename);

    await writeFile(localPath, buffer);

    return {
      originalName: safeName,
      localPath,
      mimeType,
      sizeBytes,
      extension: path.extname(safeName),
    };
  }

  async read(filePath: string): Promise<Buffer> {
    const resolved = path.resolve(filePath);
    return readFile(resolved);
  }

  async exists(filePath: string): Promise<boolean> {
    const resolved = path.resolve(filePath);
    try {
      await access(resolved, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}
