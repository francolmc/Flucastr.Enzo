# enzo-integrations

This folder contains code that was removed from `@enzo/core` during the core-slim refactor.

These modules are **not active** — they are preserved as reference implementations to be rebuilt as MCP servers or Skills in the future.

## Contents

| Folder | Description | Future implementation |
|---|---|---|
| `email/` | EmailService, IMAP/Gmail/Graph adapters, OAuth | MCP server: `enzo-mcp-email` |
| `calendar/` | CalendarService (SQLite agenda) | MCP server: `enzo-mcp-calendar` |
| `voice/` | WhisperTranscription, EdgeTTS, AudioConverter | MCP server or skill |
| `vision/` | OllamaVisionService | MCP server or skill |
| `files/` | FileHandler, MarkItDownConverter | MCP server or skill |
| `echo-tasks/` | MorningBriefingTask, NightSummaryTask, ContextRefreshTask, DailyRoutineTasks | Skills invoked from declarative echo jobs |
| `tools/` | WebSearchTool, CalendarTool, EmailTools, ReadFileTool, WriteFileTool, ExecuteCommandTool, SendFileTool | Register via MCP or custom ToolRegistry |
| `config/` | emailConfig.ts, emailParsing.ts | Consumed by future email MCP |

## Why they were removed

Enzo's core is a reasoning engine: LLM-first classification, contextual memory, and the AmplifierLoop (THINK → ACT → OBSERVE → SYNTHESIZE). Integrations with third-party services do not belong in the core — they should be plugged in via MCPs or Skills, keeping the core lean and model-agnostic.

## How to use these in the future

1. Create a new MCP server package (e.g. `packages/mcp-email/`)
2. Copy the relevant code from this folder as a starting point
3. Expose the functionality as MCP tools
4. Register the MCP server in Enzo via `~/.enzo/mcp.json`
