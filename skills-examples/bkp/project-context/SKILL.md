---
name: project-context
description: >
  Provee contexto y estado de los proyectos activos del usuario.
  Úsala cuando el usuario pregunte por sus proyectos, cómo van,
  o necesite información sobre el estado de un proyecto específico.
version: 2.0.0
enabled: true
---

# Skill: Project Context

## Flujo obligatorio para responder sobre proyectos

Usar **dos fuentes en orden**, combinando sus resultados:

### Fuente 1 — Filesystem (siempre primero)

```
{"tool":"execute_command","input":{"command":"ls -1 $HOME/Enzo/projects"}}
```

Esto da la lista real de proyectos existentes en disco. Si el usuario pregunta por un proyecto específico, continuar con:

```
{"tool":"read_file","input":{"path":"$HOME/Enzo/projects/<slug>/ENZO_PROJECT.md"}}
```

### Fuente 2 — Memoria

```
{"tool":"recall","input":{"query":"projects"}}
```

Si el usuario menciona un proyecto específico, también hacer:

```
{"tool":"recall","input":{"query":"<nombre del proyecto>"}}
```

## Reglas de combinación

- El `ENZO_PROJECT.md` es la fuente de verdad para: descripción, estado actual, fase, enlaces y notas técnicas.
- `recall` complementa con: avances recientes, tareas pendientes capturadas en conversaciones anteriores.
- Si ambas fuentes tienen datos contradictorios, preferir el filesystem y mencionarlo si es relevante.
- Si no hay carpeta en `$HOME/Enzo/projects` Y no hay datos en memoria → decirlo honestamente.

## Formato de respuesta

Incluir siempre:
- **Estado / Fase**: (idea / activo / pausado / archivado)
- **Resumen**: qué es el proyecto
- **Último avance**: lo más reciente que se sabe
- **Siguiente paso**: próxima acción concreta si está disponible

Ejemplos de uso:
- "cómo van mis proyectos"
- "dame contexto del proyecto"
- "qué proyectos tengo activos"
- "estado del proyecto X"
- "avance de Flucastr"