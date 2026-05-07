---
name: github-cli-enzo
description: >
  Usa la CLI de GitHub (`gh`) para listar y gestionar issues, PRs,
  repositorios y releases desde la terminal. Úsala cuando el usuario
  necesite operaciones con GitHub desde terminal, mencione `gh`, o pregunte
  por descripción, issues, PRs, releases o estado de cualquier repositorio.
version: 2.0.0
---

# GitHub CLI (gh) para Enzo

La CLI ya está configurada (`gh auth login` hecho). No volver a pedir autenticación salvo que un comando falle con error explícito de auth.

## GitHub owner por defecto

**Owner por defecto: `francolmc`**

Cuando el usuario mencione un repo por nombre corto (ej: "Flucastr.Enzo") sin dar el owner completo, usar siempre `francolmc/<nombre>`.

Si hay un repo git activo en el directorio actual, verificar el owner real con:
```
git remote get-url origin
```
y usar ese owner en lugar del default solo si el resultado es explícito.

## Regla de ejecución

- **Operaciones de lectura** (view, list, status, describe): ejecutar el comando `gh` directamente **sin pedir confirmación**. El usuario espera resultados, no una pregunta sobre qué comando usar.
- **Operaciones de escritura** (create, merge, delete, close): proponer el comando y esperar confirmación explícita antes de ejecutar.

## Intención → Comando automático

Cuando el usuario exprese una intención en lenguaje natural, mapear a estos comandos:

| Intención del usuario | Comando a ejecutar |
|---|---|
| "descripción / info del repo X" | `gh repo view francolmc/X` |
| "mis repos" / "lista mis repositorios" | `gh repo list francolmc` |
| "issues del repo X" | `gh issue list -R francolmc/X` |
| "ver issue #N del repo X" | `gh issue view N -R francolmc/X` |
| "PRs abiertos del repo X" | `gh pr list -R francolmc/X` |
| "ver PR #N" | `gh pr view N` |
| "estado de CI / runs del repo X" | `gh run list -R francolmc/X` |
| "clonar repo X" | `gh repo clone francolmc/X` |
| "crea un issue en X" | `gh issue create -R francolmc/X` (con título/body) |
| "crea un PR" | `gh pr create` (desde rama actual) |
| "releases del repo X" | `gh release list -R francolmc/X` |

Si el repo no se menciona explícitamente pero hay uno activo en el directorio, usar `gh repo view` sin argumentos (detecta el remoto automáticamente).

## Cuándo usar `gh`

- Listar o inspeccionar PRs, issues, releases, workflows, checks.
- Crear PR/issue, comentar, mergear, revisar diff de PR desde terminal.
- Clonar (`gh repo clone`) o fork cuando encaja mejor que `git clone` solo.
- Consultas que el API cubre mejor que la web: `gh api` con rutas REST o GraphQL.

## Anti-patrones

- No sustituir `git` cuando baste con commits/branch locales sin tocar GitHub.
- No exponer tokens ni pegar salida de `gh auth token` en el chat.
- No inventar el owner si hay ambigüedad real: usar `francolmc` como fallback seguro o ejecutar `git remote get-url origin` para confirmar.
- No pedir al usuario que escriba el comando — Enzo lo construye y ejecuta directamente.

## IMPORTANTE

**No inventar** nombres de repositorios, issues ni salida de `gh`. Una lista de repos solo es válida si proviene de la **salida real** de un comando ejecutado o de la API después de ejecutarla.

Ejemplos de uso:
- "muéstrame la descripción del proyecto Flucastr.Enzo"
- "qué issues tiene este repo"
- "dame los PRs abiertos de Flucastr.Enzo"
- "lista mis repos de GitHub"
- "crea un issue para el bug tal"
- "qué releases tiene francolmc/Flucastr.Enzo"