import { LLMProvider } from '../providers/types.js';

export interface OrganizeResult {
  shellCommand: string;
  output: string;
  mode: 'named-folder' | 'semantic';
  groups: Record<string, string[]>;
}

type TimeoutFn = <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;

export class FileOrganizationService {
  constructor(
    private provider: LLMProvider,
    private withTimeout: TimeoutFn
  ) {}

  /**
   * Extracts filenames from an ls output string.
   * Handles two formats:
   * 1. Raw ls output: "FizzBuzz\nIntroProgra\n..."
   * 2. JSON-wrapped (from ReAct loop): contains "stdout":"FizzBuzz\\n..."
   */
  extractFilenames(lsOutput: string): string[] {
    const stdoutMatch = lsOutput.match(/"stdout"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (stdoutMatch) {
      return stdoutMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('total '));
    }
    return lsOutput
      .split('\n')
      .map(l => l.trim())
      .filter(l =>
        l.length > 0 &&
        !l.startsWith('Step ') &&
        !l.startsWith('Observed') &&
        !l.startsWith('Tool execution') &&
        !l.startsWith('total ')
      );
  }

  /**
   * Detects if the user specified a named target folder.
   * Returns the folder name or null if semantic categorization should be used.
   */
  detectNamedFolder(message: string): string | null {
    const match = message.match(
      /(?:carpeta\s+(?:llamada|de\s+nombre|con\s+nombre)|folder\s+(?:called|named)|into\s+(?:a\s+folder\s+(?:called|named))?|en\s+una\s+carpeta\s+llamada)\s+["']?([\w][\w_\-.]*)["']?/i
    );
    return match?.[1] ?? null;
  }

  /**
   * Builds the shell command to move all files into a single named folder.
   */
  buildNamedFolderCommand(files: string[], targetDir: string, folderName: string): string {
    const destFolder = `${targetDir}/${folderName}`;
    const filesToMove = files
      .filter(f => f !== folderName)
      .map(f => `"${targetDir}/${f.replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`)
      .join(' ');
    return filesToMove.length > 0
      ? `mkdir -p "${destFolder}" && mv ${filesToMove} "${destFolder}/"`
      : `mkdir -p "${destFolder}"`;
  }

  /**
   * Asks the LLM to assign semantic categories to filenames.
   * Falls back to extension-based categorization if the LLM fails.
   */
  async categorizeFiles(files: string[]): Promise<Record<string, string>> {
    const fileListStr = files.join('\n');
    const prompt = `You are organizing files in a directory.
Look at each filename and understand what it is about — its purpose, project, or topic.
Group files that belong together into meaningful folder names.

FILES (one per line):
${fileListStr}

Rules:
- Use the filename content to infer meaning (not just the extension)
- Group related files together (e.g. files about the same project, topic, or workflow)
- Use concise Spanish folder names without spaces (use _ instead): "Proyecto_CLARA", "Flujos_Aprobacion", "Arquitectura"
- Every file must be assigned to exactly one folder

CRITICAL: Your entire response must be ONE JSON object.
Start your response with { and end with }.
No text before {. No text after }. No markdown. No explanation. No \`\`\`json.

Example format:
{
  "file1.xlsx": "Categoria1",
  "image.png": "Categoria2",
  "document.docx": "Categoria1"
}`;

    let mapping: Record<string, string> = {};
    try {
      const response = await this.withTimeout(
        this.provider.complete({
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: 'Categorize these files.' },
          ],
          temperature: 0.3,
          maxTokens: 768,
        }),
        60_000,
        'file categorization'
      );
      const raw = response.content?.trim() ?? '';
      console.log('[FileOrganizationService] Categorization response:', raw.substring(0, 500));
      try {
        mapping = JSON.parse(raw);
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { mapping = JSON.parse(jsonMatch[0]); } catch { /* ignored */ }
        }
      }
    } catch (err) {
      console.error('[FileOrganizationService] LLM categorization failed:', err);
    }

    if (Object.keys(mapping).length === 0) {
      console.warn('[FileOrganizationService] LLM returned no mapping, using extension-based fallback');
      for (const f of files) mapping[f] = this.categorizeByExtension(f);
    }

    return mapping;
  }

  /**
   * Builds the mkdir + mv command for semantic organization.
   */
  buildSemanticOrganizeCommand(mapping: Record<string, string>, targetDir: string): { command: string; groups: Record<string, string[]> } {
    const groups: Record<string, string[]> = {};
    for (const [file, cat] of Object.entries(mapping)) {
      const safeCat = String(cat).replace(/['"]/g, '').trim();
      if (!groups[safeCat]) groups[safeCat] = [];
      groups[safeCat].push(file);
    }

    const escShell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`');

    const mkdirArgs = Object.keys(groups)
      .map(cat => `"${targetDir}/${cat}"`)
      .join(' ');

    const mvCmds = Object.entries(groups)
      .flatMap(([cat, items]) =>
        items.map(f => `mv "${targetDir}/${escShell(f)}" "${targetDir}/${escShell(cat)}/"`)
      )
      .join('; ');

    return { command: `mkdir -p ${mkdirArgs}; ${mvCmds}`, groups };
  }

  private categorizeByExtension(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (['png','jpg','jpeg','gif','webp','svg','bmp','heic','tiff','ico'].includes(ext)) return 'Imagenes';
    if (['pdf','doc','docx','txt','md','odt','rtf','pages','epub'].includes(ext)) return 'Documentos';
    if (['xls','xlsx','csv','numbers','ods'].includes(ext)) return 'Planillas';
    if (['ppt','pptx','key','odp'].includes(ext)) return 'Presentaciones';
    if (['mp4','mov','avi','mkv','webm','m4v','wmv'].includes(ext)) return 'Videos';
    if (['mp3','wav','aac','m4a','flac','ogg'].includes(ext)) return 'Audio';
    if (['zip','tar','gz','bz2','rar','7z','dmg','pkg','iso'].includes(ext)) return 'Instaladores';
    return 'Otros';
  }
}
