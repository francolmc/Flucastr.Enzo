# AmplifierLoop Usage Example

## Overview

The AmplifierLoop is the core reasoning engine of Enzo. It implements a THINK-ACT-OBSERVE-SYNTHESIZE loop that allows the model to iteratively reason through problems and gather information.

## Basic Usage

```typescript
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AmplifierLoop } from './AmplifierLoop.js';
import { AmplifierInput } from './types.js';

// Initialize provider
const provider = new OllamaProvider('http://localhost:11434', 'qwen2.5:7b');

// Create AmplifierLoop with custom max iterations
const amplifier = new AmplifierLoop(provider, { maxIterations: 8 });

// Prepare input
const input: AmplifierInput = {
  message: 'What is the capital of France?',
  conversationId: 'conv-123',
  userId: 'user-456',
  history: [],
  availableTools: [],
  availableSkills: [],
  availableAgents: [],
};

// Run amplification
const result = await amplifier.amplify(input);

console.log('Final Answer:', result.content);
console.log('Steps Used:', result.stepsUsed.length);
console.log('Models Used:', result.modelsUsed);
console.log('Duration:', result.durationMs, 'ms');
```

## Integration with Orchestrator

The Orchestrator now uses AmplifierLoop internally:

```typescript
import { Orchestrator } from './Orchestrator.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';

const ollamaProvider = new OllamaProvider('http://localhost:11434', 'qwen2.5:7b');
const orchestrator = new Orchestrator(ollamaProvider);

// Register skills and agents
orchestrator.setAvailableSkills([
  // Your skills here
]);

orchestrator.setAvailableAgents([
  // Your agents here
]);

// Process a message
const response = await orchestrator.process({
  message: 'Analyze this code and suggest improvements',
  conversationId: 'conv-123',
  userId: 'user-456',
});

console.log('Response:', response.content);
```

## Loop Flow

1. **THINK**: Base model analyzes what information is needed
2. **ACT**: Execute appropriate action (tool, skill, agent, or escalate)
3. **OBSERVE**: Integrate results into context
4. **Decision**: Check if sufficient information gathered
   - If yes → proceed to SYNTHESIZE
   - If no → next iteration (up to maxIterations)
5. **SYNTHESIZE**: Base model generates final answer

## Step Tracking

Each iteration produces a Step with metadata:

```typescript
interface Step {
  iteration: number;           // Which iteration (1-8)
  type: 'think' | 'act' | 'observe' | 'synthesize';
  action?: 'tool' | 'skill' | 'agent' | 'escalate' | 'none';
  target?: string;             // Name of tool/skill/agent used
  input?: string;              // Input to the action
  output?: string;             // Result of the action
  modelUsed: string;           // Which model performed this step
}
```

## Capability Resolution

The CapabilityResolver automatically determines which capability to use based on the model's thinking:

- **External data needed** → tool (web_search, read_file, execute_command)
- **Specific capability** → skill
- **Specialized expertise** → agent
- **Model can't reason further** → escalate to powerful provider
- **Sufficient information** → none (proceed to synthesis)

## Context Compression

The ContextSynthesizer compresses all steps into a digestible summary for the final synthesis step, ensuring:

- Reduced token usage
- Maintained context quality
- Transparent model switching (user never notices)
- Consistent Enzo personality

## Future Extensions

- **MCP Integration (already implemented)**:
  - MCP servers are persisted and loaded via `MCPRegistry` (`MCP_AUTO_CONNECT=true` on startup).
  - Orchestrator injects MCP capabilities as tools named `mcp_<serverId>_<toolName>`.
  - AmplifierLoop executes those capabilities through `MCPRegistry.callTool(...)`.
  - From the model side, MCP usage follows the same JSON tool contract:
    `{"action":"tool","tool":"mcp_<serverId>_<toolName>","input":{...}}`
- **Custom Iterators**: Override loop behavior for specific use cases
- **Skill Composition**: Chain multiple skills in a single iteration
- **Agent Delegation**: Full agent-based reasoning workflows
