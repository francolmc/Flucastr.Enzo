---
name: enzo-project-workspace
description: >
  Gestiona un workspace de proyectos personales bajo una raíz fija en $HOME/Enzo/projects.
  Crea carpetas de proyecto, clone de repositorios, documentación local y notas.
  Úsala cuando el usuario mencione un proyecto por nombre sin dar ruta,
  pida contexto de un proyecto, o necesite crear o scaffoldear un nuevo proyecto.
version: 2.0.0
---

# Workspace de proyectos Enzo

## Raíz única

- **Carpeta base**: `$HOME/Enzo/projects` (en macOS: `/Users/franco/Enzo/projects`)
- Crear `Enzo/projects` si no existe antes de cualquier operación.

## Estructura por proyecto

Para un proyecto llamado `nombre-proyecto`:

```
Enzo/projects/nombre-proyecto/
├── ENZO_PROJECT.md    # Metadatos y descripción local (obligatorio para este skill)
├── repo/              # opcional: clone del repositorio si aplica
├── docs/              # opcional: documentación extra generada aquí
└── notes/             # opcional: ideas sueltas ligadas al proyecto
```

## Cuando el usuario habla del «proyecto X» — Flujo obligatorio

**PASO 1 — SIEMPRE listar el workspace primero** (no responder desde memoria antes de este paso):

```
execute_command: ls -1 $HOME/Enzo/projects
```

Esto da la lista real de proyectos disponibles. Sin este paso no se puede saber qué existe.

**PASO 2 — Resolver el proyecto por nombre**

Con la lista obtenida en el paso anterior:

1. Match exacto de directorio con el nombre o slug dado.
2. Match case-insensitive si no hay exacto.
3. Si hay varios candidatos: leer los `ENZO_PROJECT.md` de los candidatos y comparar el título o alias.
4. Si sigue siendo ambiguo: listar los proyectos encontrados y pedir clarificación.

**PASO 3 — Leer el contexto del proyecto**

Una vez identificada la carpeta:

```
read_file: $HOME/Enzo/projects/<slug>/ENZO_PROJECT.md
```

Usar el contenido de ese archivo como fuente principal de contexto (estado, resumen, enlaces, notas para Enzo). No inventar ni asumir datos que no estén en el archivo.

## Archivo `ENZO_PROJECT.md`

Archivo **local** distinto del `README` del repositorio.

Plantilla sugerida:

```markdown
# [Nombre del proyecto]

## Alias
Otros nombres por los que el usuario puede referirse.

## Resumen
2–4 frases: qué es y para qué sirve.

## Enlaces
- Repo:
- Documentación:

## Estado
- Fase: (idea / activo / pausado / archivado)
- Última actualización: YYYY-MM-DD

## Notas para Enzo
Contexto que no está en el README.
```

## Ejemplo de flujo completo

Usuario: "dame contexto del proyecto Flucastr"

1. `execute_command: ls -1 $HOME/Enzo/projects` → encuentra carpeta `flucastr` o `Flucastr.Enzo`
2. `read_file: $HOME/Enzo/projects/flucastr/ENZO_PROJECT.md` → lee metadatos
3. Responder con el contenido del archivo: resumen, estado, enlaces, notas.

Ejemplos de uso:
- "crea un nuevo proyecto"
- "dame contexto del proyecto X"
- "qué es el proyecto Flucastr"
- "qué proyectos tengo en mi workspace"
- "abrir el workspace de mi proyecto"