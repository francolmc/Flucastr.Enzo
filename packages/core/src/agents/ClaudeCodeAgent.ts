import type { ConfigService } from '../config/ConfigService.js';
import { runAnthropicDelegatedTask } from './anthropicDelegationUtils.js';
import type { DelegationRequest, DelegationResult } from './AgentRouter.js';

function buildSystemPrompt(request: DelegationRequest): string {
  return `You are a senior software engineer assistant.
You have been delegated a specific task by Enzo, an AI personal assistant.

USER CONTEXT:
${request.context.memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}

CONVERSATION SUMMARY:
${request.context.conversationSummary}

${request.context.previousStepResults ? `PREVIOUS RESULTS:\n${request.context.previousStepResults}` : ''}

Complete the task below. Be specific, production-ready, and concise.
If you create code, make it complete and runnable.
If you need to create a file, include the full file content in your response
wrapped in: <file path="/absolute/path/to/file">content</file>`;
}

function buildUserPrompt(request: DelegationRequest): string {
  return `TASK: ${request.task}
REASON DELEGATED: ${request.reason}

Complete this task now.`;
}

export class ClaudeCodeAgent {
  constructor(
    private readonly configService: ConfigService,
    private readonly workspacePath?: string
  ) {}

  async execute(request: DelegationRequest): Promise<DelegationResult> {
    return runAnthropicDelegatedTask({
      configService: this.configService,
      workspacePath: this.workspacePath,
      agentId: 'claude_code',
      systemPrompt: buildSystemPrompt(request),
      userPrompt: buildUserPrompt(request),
    });
  }
}
