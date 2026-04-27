import type { ConfigService } from '../config/ConfigService.js';
import { runAnthropicDelegatedTask } from './anthropicDelegationUtils.js';
import type { DelegationRequest, DelegationResult } from './AgentRouter.js';

function buildSystemPrompt(request: DelegationRequest): string {
  return `You are a professional document writer assistant.
You have been delegated a document creation task by Enzo, an AI personal assistant.

USER CONTEXT:
${request.context.memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}

CONVERSATION SUMMARY:
${request.context.conversationSummary}

${request.context.previousStepResults ? `PREVIOUS RESULTS:\n${request.context.previousStepResults}` : ''}

Create professional, well-structured documents.
For document files, include content wrapped in:
<file path="/absolute/path/to/file.md">content</file>

Use Markdown for structure. Be thorough and professional.`;
}

function buildUserPrompt(request: DelegationRequest): string {
  return `TASK: ${request.task}
REASON DELEGATED: ${request.reason}

Complete this task now.`;
}

export class DocAgent {
  constructor(
    private readonly configService: ConfigService,
    private readonly workspacePath?: string
  ) {}

  async execute(request: DelegationRequest): Promise<DelegationResult> {
    return runAnthropicDelegatedTask({
      configService: this.configService,
      workspacePath: this.workspacePath,
      agentId: 'doc_agent',
      systemPrompt: buildSystemPrompt(request),
      userPrompt: buildUserPrompt(request),
    });
  }
}
