---
name: project-context
description: >
  Provee contexto y estado de los proyectos activos del usuario.
  Úsala cuando el usuario pregunte por sus proyectos, cómo van,
  o necesite información sobre el estado de un proyecto específico.
version: 1.0.0
enabled: true
---

# Skill: Project Context

Para responder sobre proyectos del usuario, usar la tool recall:
```
{"tool":"recall","input":{"query":"projects"}}
```

Luego responder con la información encontrada en memoria.
Si no hay información, decirlo honestamente.

Reglas:
- Usar recall para obtener datos actualizados
- Incluir estado, último avance y siguiente paso
- Si no hay datos, ser honesto

Ejemplos de uso:
- "cómo van mis proyectos"
- "dame contexto del proyecto"
- "qué proyectos tengo activos"
- "estado del proyecto X"
- "avance de misConsultoría"