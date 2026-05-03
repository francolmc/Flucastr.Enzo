---
name: github-cli-enzo
description: >
  Usa la CLI de GitHub (`gh`) para listar y gestionar issues, PRs,
  repositorios y releases desde la terminal. Úsala cuando el usuarios
  necesite operaciones con GitHub desde terminal o mencione `gh`.
version: 1.0.0
---

# GitHub CLI (gh) para Enzo

La CLI ya está configurada (`gh auth login` hecho). No volver a pedir autenticación salvo que un comando falle con error explícito de auth.

## Cuándo usar `gh`

- Listar o inspeccionar PRs, issues, releases, workflows, checks.
- Crear PR/issue, comentar, mergear, revisar diff de PR desde terminal.
- Clonar (`gh repo clone`) o fork cuando encaja mejor que `git clone` solo.
- Consultas que el API cubre mejor que la web: `gh api` con rutas REST o GraphQL.

## Patrones rápidos

- Repo actual: `gh repo view`, `gh pr status`, `gh pr list`.
- PR desde rama actual: `gh pr create` (con título/cuerpo por flags o archivo).
- Issue: `gh issue list`, `gh issue view <n>`, `gh issue create`.
- CI: `gh run list`, `gh run watch`.
- API genérico: `gh api repos/:owner/:repo/...`

## Anti-patrones

- No sustituir `git` cuando baste con commits/branch locales sin tocar GitHub.
- No exponer tokens ni pegar salida de `gh auth token` en el chat.
- No asumir `owner/repo` si el remoto es ambiguo: comprobar `git remote -v` o `gh repo view`.

## IMPORTANTE

**No inventar** nombres de repositorios, issues ni salida de `gh`. Una lista de repos solo es válida si proviene de la **salida real** de un comando ejecutado o de la API después de ejecutarla.

Ejemplos de uso:
- "listame mis repos"
- "dame los PRs abiertos"
- "qué issues tiene este repo"
- "crea un issue para el bug tal"