import { LLMProvider, Message } from '../providers/types.js';

export interface Subtask {
  id: number;
  description: string;
  tool: string;
  input: string;          // Descripción en lenguaje natural del input
  dependsOn: number | null; // ID de la subtarea de la que depende
}

export interface DecompositionResult {
  steps: Subtask[];
  originalMessage: string;
}

export class Decomposer {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async decompose(message: string, availableTools: string[], history?: Message[]): Promise<DecompositionResult> {
    const toolsList = availableTools.join(', ');
    const hasPdfMcpTools = availableTools.some(
      (toolName) =>
        toolName.startsWith('mcp_') &&
        (toolName.includes('_display_pdf') ||
          toolName.includes('_interact') ||
          toolName.includes('_read_pdf_bytes') ||
          toolName.includes('_list_pdfs'))
    );

    // Include last 4 messages as context so the Decomposer can understand follow-up references
    // like "do it", "proceed", "create those folders" without losing the original path/plan
    let contextBlock = '';
    if (history && history.length > 0) {
      const recent = history.slice(-4);
      const lines = recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content ?? '').substring(0, 300)}`);
      contextBlock = `\nCONVERSATION CONTEXT (use this to understand references like "do it", "create those folders", "proceed"):\n${lines.join('\n')}\n`;
    }

    const systemPrompt = `You are a task decomposer. Break the task into the MINIMUM number of sequential steps.
Each step must be ONE single action using ONE tool.

Available tools: ${toolsList}

TOOL SELECTION RULES:
- web_search: search the internet for information
- write_file: create or write content to a file (use this, NOT execute_command, to create files)
- read_file: read an existing file — the path must be verbatim from the user message or from prior ls output; never translate or paraphrase file names
- execute_command: run shell commands — NOT for creating files with content
- remember: save a fact to memory
${hasPdfMcpTools ? `- mcp_* tools: use these for PDF workflows when available` : ''}

CRITICAL — for execute_command, the "input" field MUST be the exact shell command to run:
- List folder: "input": "ls /absolute/path"
- Create folder: "input": "mkdir -p /absolute/path"
- Move files: "input": "mv /source /destination"
- Combined: "input": "mkdir -p /dest && mv /src/file1 /src/file2 /dest/"
NEVER put just a path in "input" — always put the full shell command.

PLACEHOLDER PATHS — ABSOLUTELY FORBIDDEN in execute_command:
- Never use invented templates: /path/to/..., path/to/, <path>, YOUR_PATH_HERE, example/folder
- Only use absolute paths that appear VERBATIM in the user's message or in CONVERSATION CONTEXT (e.g. /home/franco/Projects)
- If the user asks for abstract "task management" or "organize my work/life" without giving real directories to move: return "steps": [] (empty array) — do NOT invent mkdir/mv commands

Respond ONLY with valid JSON, no extra text:
{
  "steps": [
    {
      "id": 1,
      "description": "what this step does",
      "tool": "tool_name",
      "input": "exact description of input for this tool",
      "dependsOn": null
    },
    {
      "id": 2,
      "description": "what this step does",
      "tool": "tool_name",
      "input": "use result from step 1",
      "dependsOn": 1
    }
  ]
}

IMPORTANT: The "dependsOn" field is REQUIRED in every step. First step MUST have "dependsOn": null. Never omit it.

FILE ORGANIZATION TASKS (only when the user names a REAL absolute folder to tidy, e.g. "organize /Users/me/Downloads"):
- If the file list is NOT in context: generate 2 steps:
  Step 1: execute_command with "input": "ls /absolute/path/to/folder", "dependsOn": null
  Step 2: execute_command with "input": "organize files using ls output", "dependsOn": 1
- If the file list IS already in context (from a previous ls): generate 1 step:
  Step 1: execute_command with the complete mkdir+mv command directly, "dependsOn": null
- NEVER use relative paths — every path must start with /
- "input" for execute_command MUST be the actual shell command, never just a folder path
- If there is no real path in the user message or context: return "steps": [] — do not guess paths

CRITICAL RULES:
- Use the MINIMUM number of steps — never add intermediate steps that are not necessary
- To search then save to file: use EXACTLY 2 steps (web_search → write_file)
- Never use execute_command to create a file with content — use write_file instead
- Never add a read_file step after a web_search — the search result is already in context
- NEVER use relative paths — always use the absolute path from the user's message
${hasPdfMcpTools ? `- If the user asks to read/summarize/extract a .pdf, DO NOT use read_file for that PDF. Prefer MCP PDF tools (mcp_*_display_pdf + mcp_*_interact or other mcp_*_pdf tools).` : ''}

EXAMPLES:
Task: "search X and create file Y with a summary"
→ Step 1: web_search (search X)
→ Step 2: write_file (create Y with summary from step 1)
That is ALL — 2 steps only.

Task: "list my Downloads folder"
→ Step 1: execute_command (ls /Users/franco/Downloads)
That is ALL — 1 step only.

Task: "organiza /Users/franco/Downloads" or "organize /Users/franco/Downloads"
→ Step 1: execute_command (ls /Users/franco/Downloads)
→ Step 2: execute_command (organize files using ls output — dependsOn: 1)
That is ALL — 2 steps only.`;

    try {
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
      ];
      if (contextBlock) {
        messages.push({ role: 'system', content: contextBlock });
      }
      messages.push({ role: 'user', content: message });

      const response = await this.provider.complete({
        messages,
        temperature: 0.2,
        maxTokens: 512,
      });

      const content = response.content?.trim() ?? '';
      console.log('[Decomposer] Raw response:', content.substring(0, 300));

      // Extraer JSON con stack-based matching para manejar objetos anidados correctamente
      const jsonMatch = this.extractFirstJson(content);
      if (!jsonMatch) {
        console.warn('[Decomposer] No JSON found in response, using single-step fallback');
        return this.singleStepFallback(message);
      }

      const parsed = JSON.parse(jsonMatch);

      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        console.warn('[Decomposer] Invalid steps array, using single-step fallback');
        return this.singleStepFallback(message);
      }

      const normalizedSteps = this.rewritePdfReadStepsToMcp(message, parsed.steps, availableTools);
      const sanitized = this.stripInvalidExecuteCommandSteps(normalizedSteps);
      if (sanitized.length === 0) {
        console.warn('[Decomposer] All steps removed (placeholders or invalid shell) — returning empty plan');
        return { steps: [], originalMessage: message };
      }

      console.log(`[Decomposer] Decomposed into ${sanitized.length} step(s):`,
        sanitized.map((s: Subtask) => `${s.id}. ${s.tool}: ${s.description}`).join(' → ')
      );

      return {
        steps: sanitized,
        originalMessage: message,
      };
    } catch (error) {
      console.error('[Decomposer] Error decomposing task:', error);
      return this.singleStepFallback(message);
    }
  }

  // Extrae el primer JSON object balanceado de un string (stack-based, maneja anidamiento)
  private extractFirstJson(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  private static commandContainsPlaceholderPath(text: string): boolean {
    const t = text.toLowerCase();
    return (
      /\/path\/to\b/i.test(t) ||
      /\bpath\/to\//i.test(t) ||
      /<path/i.test(t) ||
      /\byour_path_here\b/i.test(t) ||
      /\bexample\/folder\b/i.test(t)
    );
  }

  /**
   * If any execute_command uses template paths, drop the whole decomposition so AmplifierLoop
   * can synthesize a safe reply (partial removal would break dependsOn chains).
   */
  private stripInvalidExecuteCommandSteps(steps: Subtask[]): Subtask[] {
    const bad = steps.some(
      (s) =>
        s.tool === 'execute_command' && Decomposer.commandContainsPlaceholderPath(String(s.input ?? ''))
    );
    if (bad) {
      console.warn('[Decomposer] Placeholder path in execute_command — clearing all decomposition steps');
      return [];
    }
    return steps;
  }

  // Fallback: tratar el mensaje como una sola subtarea sin tool específica
  private singleStepFallback(message: string): DecompositionResult {
    return {
      steps: [
        {
          id: 1,
          description: message,
          tool: 'none',
          input: message,
          dependsOn: null,
        },
      ],
      originalMessage: message,
    };
  }

  private rewritePdfReadStepsToMcp(message: string, steps: Subtask[], availableTools: string[]): Subtask[] {
    const mentionsPdf = /\.pdf(\b|$)/i.test(message);
    if (!mentionsPdf || !Array.isArray(steps) || steps.length === 0) {
      return steps;
    }

    const preferredPdfTool =
      availableTools.find((tool) => tool.startsWith('mcp_') && tool.includes('_interact')) ||
      availableTools.find((tool) => tool.startsWith('mcp_') && tool.includes('_display_pdf')) ||
      availableTools.find((tool) => tool.startsWith('mcp_') && tool.includes('_read_pdf_bytes')) ||
      null;

    if (!preferredPdfTool) {
      return steps;
    }

    let rewrote = false;
    const updated = steps.map((step) => {
      const stepText = `${step.description} ${step.input}`.toLowerCase();
      const looksLikePdfRead = step.tool === 'read_file' && (stepText.includes('.pdf') || stepText.includes('pdf'));
      if (!looksLikePdfRead) {
        return step;
      }
      rewrote = true;
      return {
        ...step,
        tool: preferredPdfTool,
        description: step.description.replace(/read/i, 'access via MCP').replace(/archivo/i, 'PDF via MCP'),
        input: step.input || message,
      };
    });

    if (rewrote) {
      console.log(`[Decomposer] Rewrote PDF read step(s) to MCP tool: ${preferredPdfTool}`);
    }

    return updated;
  }
}
