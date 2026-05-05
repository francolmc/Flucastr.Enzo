import express from "express";
import cors from "cors";
import path from "path";
import { mkdirSync, existsSync, lstatSync } from "fs";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { homedir } from "os";
import {
  Orchestrator,
  OllamaProvider,
  AnthropicProvider,
  MemoryService,
  SkillRegistry,
  MCPRegistry,
  ConfigService,
  EncryptionService,
  ensureLocalSecret,
  getMemoryMetricsSnapshot,
} from "@enzo/core";
import {
  createDefaultToolRegistry,
  getEchoEngine,
  getEchoNotificationGateway,
  createNotificationGateway,
  createAgentRouter,
  bindEchoDeclarativeOrchestrator,
} from "@enzo/bootstrap";
import { createChatRouter } from "./routes/chat.js";
import { createMemoryRouter } from "./routes/memory.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createStatsRouter } from "./routes/stats.js";
import { createConfigRouter } from "./routes/config.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createMCPRouter } from "./routes/mcp.js";
import { createEchoRouter } from "./routes/echo.js";
import { createProjectsRouter } from "./routes/projects.js";
import { errorHandler } from "./middleware/errorHandler.js";

process.env.ENZO_RUNTIME_ROLE ||= "api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure local persistent secret exists for encryption
const enzoSecret = ensureLocalSecret();


function normalizeConfiguredPath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  if (!configValue || !configValue.trim()) {
    return fallbackAbsolutePath;
  }
  const trimmed = configValue.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(homedir(), trimmed);
}

function resolveSharedDirPath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  let resolved = normalizeConfiguredPath(configValue, fallbackAbsolutePath);
  if (!existsSync(resolved)) {
    try {
      mkdirSync(resolved, { recursive: true });
      console.log(`[Config] Created missing directory: ${resolved}`);
    } catch (err) {
      console.warn(`[Config] Could not create directory ${resolved}:`, err);
      resolved = fallbackAbsolutePath;
      mkdirSync(resolved, { recursive: true });
    }
  } else if (!lstatSync(resolved).isDirectory()) {
    console.warn(`[Config] Expected a directory path but got file: ${resolved}. Using fallback: ${fallbackAbsolutePath}`);
    resolved = fallbackAbsolutePath;
    mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function resolveSharedFilePath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  let resolved = normalizeConfiguredPath(configValue, fallbackAbsolutePath);
  if (existsSync(resolved) && lstatSync(resolved).isDirectory()) {
    console.warn(`[Config] Expected a file path but got directory: ${resolved}. Using fallback: ${fallbackAbsolutePath}`);
    resolved = fallbackAbsolutePath;
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

// Initialize encryption and configuration services
const encryptionService = new EncryptionService(enzoSecret);
const configService = new ConfigService(encryptionService);
const systemConfig = configService.getSystemConfig();
const workspaceRoot = resolveSharedDirPath(
  systemConfig.enzoWorkspacePath,
  path.join(homedir(), ".enzo", "workspace")
);
console.log(`[API] Workspace path: ${workspaceRoot}`);
const app = express();

const trustProxyHop = Number(process.env.ENZO_TRUST_PROXY ?? process.env.TRUST_PROXY ?? "0");
if (trustProxyHop > 0) {
  app.set("trust proxy", trustProxyHop);
}

if (!process.env.ENZO_PUBLIC_API_BASE_URL?.trim()) {
  console.warn(
    "[API] ENZO_PUBLIC_API_BASE_URL no está definida: el redirect OAuth puede derivarse del Host del request (véase ENZO_OAUTH_ORIGIN_FROM_REQUEST). Tras proxy HTTPS, definí la URL pública o ENZO_TRUST_PROXY=1 si hace falta."
  );
}

const PORT = Number(systemConfig.port || "3001");
const HOST = process.env.ENZO_API_HOST || "127.0.0.1";
const uiPort = Number(systemConfig.uiPort || "5173");
const allowedOrigins = [`http://localhost:${uiPort}`, `http://127.0.0.1:${uiPort}`];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const dbPath = resolveSharedFilePath(systemConfig.dbPath, path.join(homedir(), ".enzo", "enzo.db"));
const skillsPath = resolveSharedDirPath(systemConfig.enzoSkillsPath, path.join(homedir(), ".enzo", "skills"));
process.env.ENZO_SKILLS_PATH = skillsPath;
mkdirSync(path.dirname(dbPath), { recursive: true });
mkdirSync(skillsPath, { recursive: true });
console.log(`[API] Shared DB path: ${dbPath}`);
console.log(`[API] Shared skills path: ${skillsPath}`);

const primaryModel = configService.getPrimaryModel();
console.log(`[API] Using primary model: ${primaryModel} (from config.json)`);

const ollamaBaseUrl = systemConfig.ollamaBaseUrl || "http://localhost:11434";
const ollamaProvider = new OllamaProvider(ollamaBaseUrl, primaryModel);
const anthropicApiKey = configService.getProviderApiKey('anthropic');
const anthropicProvider = anthropicApiKey
  ? new AnthropicProvider(
      anthropicApiKey,
      systemConfig.anthropicModel || "claude-haiku-4-5"
    )
  : undefined;

const memoryService = new MemoryService(dbPath);
const agentNotificationGateway = createNotificationGateway(memoryService);
const agentRouter = createAgentRouter(configService, memoryService, agentNotificationGateway, workspaceRoot);

const skillRegistry = new SkillRegistry(undefined, memoryService);
const toolRegistry = createDefaultToolRegistry(memoryService);
const orchestrator = new Orchestrator(
  ollamaProvider,
  anthropicProvider,
  memoryService,
  { skillRegistry, configService, toolRegistry, agentRouter }
);
const mcpRegistry = orchestrator.getMCPRegistry();
const echoEngine = getEchoEngine({ memoryService, configService });
const echoNotificationGateway = getEchoNotificationGateway();
bindEchoDeclarativeOrchestrator({
  orchestrator,
  memoryService,
  configService,
  ...(echoNotificationGateway ? { notificationGateway: echoNotificationGateway } : {}),
});
echoEngine.start();

// Initialize skills on startup; watch filesystem for SKILL.md changes
skillRegistry
  .reload()
  .then(() => {
    skillRegistry.startWatching();
  })
  .catch((err: any) => {
    console.warn('[API] Failed to load skills on startup:', err);
  });

// Copy example skills to user skills directory if they don't exist
(async () => {
  try {
    const userSkillsDir = path.join(homedir(), '.enzo', 'skills');
    const examplesDir = path.join(__dirname, '../../../skills-examples');

    // Check if examples directory exists
    try {
      await fs.access(examplesDir);
    } catch {
      console.log('[API] No skills-examples directory found, skipping skill setup');
      return;
    }

    // Read example skill directories
    const examples = await fs.readdir(examplesDir, { withFileTypes: true });

    for (const entry of examples) {
      if (!entry.isDirectory()) continue;

      const exampleSkillDir = path.join(examplesDir, entry.name);
      const userSkillDir = path.join(userSkillsDir, entry.name);

      // Check if this skill already exists for the user
      try {
        await fs.access(userSkillDir);
        console.log(`[API] Skill "${entry.name}" already exists, skipping...`);
        continue;
      } catch {
        // Skill doesn't exist, copy it
        await copyDirectoryRecursive(exampleSkillDir, userSkillDir);
        console.log(`[API] Copied example skill "${entry.name}" to ${userSkillDir}`);
      }
    }
  } catch (err) {
    console.warn('[API] Failed to setup example skills:', err instanceof Error ? err.message : String(err));
  }
})();

// Helper function to recursively copy directories
async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    model: configService.getPrimaryModel(),
    memoryMetrics: getMemoryMetricsSnapshot(),
  });
});

app.use(createChatRouter(orchestrator, memoryService, configService));
app.use(createMemoryRouter(memoryService));
app.use(createProjectsRouter(memoryService));
app.use(createAgentsRouter(memoryService));
app.use(createStatsRouter(memoryService));
app.use(createConfigRouter(configService, encryptionService));
app.use(createSkillsRouter({ skillRegistry, memoryService, skillsDir: skillsPath }));
app.use(createMCPRouter(mcpRegistry));
app.use(createEchoRouter(echoEngine, echoNotificationGateway));

app.use(errorHandler);

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Enzo API corriendo en http://${HOST}:${PORT}`);
});

const shutdown = (signal: string): void => {
  console.log(`[API] ${signal} received, stopping services...`);
  skillRegistry.stopWatching();
  echoEngine.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
