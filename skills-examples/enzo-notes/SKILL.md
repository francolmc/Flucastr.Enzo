---
name: enzo-notes
description: >
  Guarda y organiza notas rápidas personales o vinculadas a proyectos en un archivo
  markdown. Úsala cuando el usuario quiera capturar algo para recordar después,
  registrar un pensamiento, o guardar una nota asociada a un proyecto.
version: 1.0.0
---

# Notas rápidas Enzo

## Ubicación

- **Archivo**: `/home/franco/notas.md`
- Equivalente si el home difiere: `$HOME/notas.md`

Crear el archivo si no existe. Mantener orden cronológico **o** por secciones fijas según convenga al usuario; por defecto: entradas nuevas **al final** del archivo (o bajo una sección del día).

## Formato de cada entrada

Usar un bloque consistente para que Enzo y el usuario escaneen rápido:

```markdown
---
fecha: YYYY-MM-DD
contexto: <una línea: de dónde salió la idea (reunión, lectura, bug, etc.)>
alcance: proyecto | personal
proyecto: <nombre corto o enlace al folder en Enzo/projects; omitir línea si alcance es personal>
---

Texto de la nota en una o más líneas. Listas y enlaces permitidos.

```

**Reglas**

- `alcance`: exactamente `proyecto` o `personal`.
- Si `alcance` es `proyecto`, incluir `proyecto:` (p. ej. slug `mi-api` o ruta `Enzo/projects/mi-api`).
- Si `alcance` es `personal`, omitir la clave `proyecto` o dejarla vacía; no inventar proyecto.
- Separar entradas con una línea en blanco o un `---` horizontal **solo** si el archivo ya usa separadores visuales; evitar exceso de reglas que hagan el archivo ruidoso.

## Operaciones habituales

- **Añadir nota**: leer el final de `notas.md`, añadir nueva entrada con fecha de hoy (usar la fecha del entorno del usuario).
- **Buscar**: usar búsqueda en workspace o `rg` sobre `notas.md` por palabra clave o por `proyecto:`.
- **Refactor**: si el archivo crece mucho, proponer al usuario secciones mensuales (`## 2026-05`) o archivo `notas-2026.md` en el mismo directorio; no fragmentar sin acuerdo.

## Privacidad

Tratar `notas.md` como posiblemente sensible; no pegar su contenido completo en resúmenes públicos sin necesidad, y no subirlo a repositorios sin que el usuario lo pida.

Ejemplos de uso:
- "guarda esto en notas"
- "escribe una nota sobre la reunión"
- "anota esto en mi archivo de notas"
