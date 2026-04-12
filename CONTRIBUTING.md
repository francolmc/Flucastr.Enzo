# Contributing to Enzo

Thanks for contributing.

## Prerequisites

- Node.js 22.14+ (Node 24 recommended)
- pnpm via Corepack
- Ollama running locally for end-to-end checks

## Setup

```bash
corepack enable
pnpm install
pnpm run setup
```

## Development

```bash
# API + UI + Telegram
pnpm dev

# Build everything
pnpm build
```

Useful package-level commands:

```bash
pnpm -F @enzo/api dev
pnpm -F @enzo/ui dev
pnpm -F @enzo/core build
```

## Before opening a PR

- Run `pnpm build` from repo root.
- Run tests from `@enzo/core` once test runner is available.
- Verify no local runtime artifacts are staged (`*.db.json`, logs, outputs).
- Update docs when behavior changes.

## Pull Requests

- Keep PRs focused and small.
- Include a short description of why the change is needed.
- Add manual test notes for behavior changes.
