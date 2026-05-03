---
name: enzo-project-workspace
description: >
  Gestiona un workspace de proyectos personales bajo una raíz fija.
  Crea carpetas de proyecto, clone de repositorios, documentación local y notas.
  Úsala cuando el usuario mencione un proyecto por nombre sin dar ruta,
  o cuándo necesite crear o scaffolding un nuevo proyecto.
version: 1.0.0
---

# Workspace de proyectos Enzo

## Raíz única

- **Carpeta base**: `/home/franco/Enzo/projects`
- Si en el equipo el home no es `/home/franco` (p. ej. macOS), usar la misma ruta relativa al home del usuario: `$HOME/Enzo/projects`, y crear `Enzo/projects` si no existe.

## Estructura por proyecto

Para un proyecto llamado `nombre-proyecto`:

```
Enzo/projects/nombre-proyecto/
├── ENZO_PROJECT.md    # Metadatos y descripción local (obligatorio para este skill)
├── repo/              # opcional: clone del repositorio si aplica
├── docs/              # opcional: documentación extra generada aquí
└── notes/             # opcional: ideas sueltas ligadas al proyecto
```

## Cuando el usuario habla del «proyecto X» (dónde buscar)

Sin ruta absoluta, **asumir** que todo proyecto vive bajo la misma raíz definida arriba. La carpeta candidata es:

`<RAÍZ_WORKSPACE>/<slug>/`

donde `<slug>` es el nombre normalizado (minúsculas, guiones, sin espacios).

**Orden de resolución**

1. Si el usuario dio un slug o nombre que coincide exactamente con un directorio, esa es la carpeta del proyecto X.
2. Si no hay match exacto: leer los nombres de las carpetas y comparar (case-insensitive).
3. Si hay ambigüedad: leer `ENZO_PROJECT.md` y comparar el título.
4. Si sigue siendo ambiguo: listar proyectos y pedir clarificación.

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

Ejemplos de uso:
- "crea un nuevo proyecto"
- "dame contexto del proyecto X"
- "qué es el proyecto Flucastr"
- "abrir el workspace de mi proyecto"