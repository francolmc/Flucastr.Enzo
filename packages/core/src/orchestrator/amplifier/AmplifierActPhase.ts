import type { LLMProvider } from '../../providers/types.js';
import type { ExecutableTool } from '../../tools/types.js';
import type { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { MCPRegistry } from '../../mcp/index.js';
import type { Step, ResolvedAction } from '../types.js';
import { normalizeError } from '../NormalizedError.js';
import { attachToolScopedUserId, validateToolInput } from './AmplifierLoopFastPathTools.js';
import type { AmplifierLoopLog } from './AmplifierLoopLog.js';
import type { ThinkPhaseDeps } from './AmplifierThinkPhase.js';

export type ActPhaseDeps = {
  baseProvider: LLMProvider;
  executableTools: ExecutableTool[];
  mcpRegistry?: MCPRegistry;
  skillRegistry?: SkillRegistry;
  log: AmplifierLoopLog;
};

/** Shared deps for THINK and ACT phases inside AmplifierLoop. */
export type AmplifierLoopPhaseDeps = ThinkPhaseDeps & ActPhaseDeps;

export type ActPhaseResult =
  | { kind: 'executed'; step: Step }
  | { kind: 'delegate'; agent: string; task: string; reason: string };

export async function runActPhase(
  deps: ActPhaseDeps,
  resolvedAction: ResolvedAction,
  iteration: number,
  modelsUsed: Set<string>,
  toolsUsed: Set<string>,
  userId?: string,
  requestId?: string
): Promise<ActPhaseResult> {
  const { baseProvider, executableTools, mcpRegistry, skillRegistry, log } = deps;
  const startTime = Date.now();
  let output = '';

  if (resolvedAction.type === 'delegate') {
    return {
      kind: 'delegate',
      agent: resolvedAction.target,
      task: resolvedAction.input.task,
      reason: resolvedAction.reason,
    };
  }

  try {
    if (resolvedAction.type === 'tool') {
      toolsUsed.add(resolvedAction.target);
      if (resolvedAction.target.startsWith('mcp_') && mcpRegistry) {
        const validationError = validateToolInput(
          resolvedAction.target,
          resolvedAction.input,
          executableTools,
          mcpRegistry
        );
        if (validationError) {
          output = `Error [TOOL_VALIDATION_ERROR]: ${validationError}`;
          return {
            kind: 'executed',
            step: {
              iteration,
              type: 'act',
              requestId,
              action: resolvedAction.type,
              target: resolvedAction.target,
              input: JSON.stringify(resolvedAction.input),
              output,
              durationMs: Date.now() - startTime,
              status: 'error',
              modelUsed: baseProvider.model,
            },
          };
        }
        try {
          const result = await mcpRegistry.callTool(resolvedAction.target, resolvedAction.input);
          output = `MCP Tool execution successful: ${result}`;
        } catch (err) {
          const normalized = normalizeError(err, 'mcp');
          output = `Error [${normalized.code}]: ${normalized.technicalMessage}`;
        }
      } else {
        const toolInput = resolvedAction.input;
        const validationError = validateToolInput(
          resolvedAction.target,
          toolInput,
          executableTools,
          mcpRegistry
        );
        if (validationError) {
          output = `Error [TOOL_VALIDATION_ERROR]: ${validationError}`;
          return {
            kind: 'executed',
            step: {
              iteration,
              type: 'act',
              requestId,
              action: resolvedAction.type,
              target: resolvedAction.target,
              input: JSON.stringify(resolvedAction.input),
              output,
              durationMs: Date.now() - startTime,
              status: 'error',
              modelUsed: baseProvider.model,
            },
          };
        }

        const tool = executableTools.find((t) => t.name === resolvedAction.target);
        if (tool) {
          const scoped = attachToolScopedUserId(
            resolvedAction.target,
            toolInput as Record<string, unknown>,
            userId
          );
          const result = await tool.execute(scoped);
          if (!result.success) {
            output = `Error [TOOL_EXECUTION_ERROR]: ${result.error}`;
          } else {
            output = result.output;
          }
        } else {
          output = `Tool not found: ${resolvedAction.target}`;
        }
      }
    } else if (resolvedAction.type === 'skill') {
      toolsUsed.add(resolvedAction.target);
      if (skillRegistry) {
        const skill =
          skillRegistry.get(resolvedAction.target) ??
          skillRegistry.getAll().find((available) => available.metadata.name === resolvedAction.target);
        if (skill) {
          output = `Skill content:\n${skill.content}`;
        } else {
          output = `Skill not found: ${resolvedAction.target}`;
        }
      } else {
        output = `Skill registry not available`;
      }
    } else if (resolvedAction.type === 'agent') {
      toolsUsed.add(resolvedAction.target);
      output = `Agent routing acknowledged for "${resolvedAction.target}". Continuing with active runtime provider.`;
    } else if (resolvedAction.type === 'escalate') {
      output = `Escalating to powerful provider for: ${resolvedAction.input}`;
    } else if (resolvedAction.type === 'mcp') {
      output = `[MCP manejado como tool, este caso es inesperado]`;
    }
  } catch (error) {
    const normalized = normalizeError(error, 'orchestrator');
    output = `Error [${normalized.code}]: ${normalized.technicalMessage}`;
    log.error(`[AmplifierLoop] Action failed at iteration ${iteration}:`, normalized.technicalMessage);
  }

  return {
    kind: 'executed',
    step: {
      iteration,
      type: 'act',
      requestId,
      action: resolvedAction.type,
      target: resolvedAction.target,
      input: JSON.stringify(resolvedAction.input),
      output,
      durationMs: Date.now() - startTime,
      status: output.toLowerCase().includes('error') ? 'error' : 'ok',
      modelUsed: baseProvider.model,
    },
  };
}
