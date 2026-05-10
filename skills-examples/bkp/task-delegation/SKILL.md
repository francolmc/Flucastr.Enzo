---
name: task-delegation
description: |
  Protocolo para delegar tareas a la IA. Cuando el usuario pida "haz esto", "organiza", 
  "busca información", "trabaja en...", etc., SIEMPRE proponer un plan detallado antes de ejecutar.
  Esperar confirmación explícita antes de ejecutar comandos destructivos.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: workflow
  tags: delegation, autonomous, tasks, workflow
allowed-tools: execute_command web_search read_file write_file list_directory
---

# Delegación de Tareas - Protocolo

## REGLAS ESTRICTAS

1. **NUNCA ejecutar comandos destructivos sin aprobación explícita**
   - Destructivos: `rm`, `mv`, `mkdir` en paths importantes, modificaciones masivas de archivos
   - Siempre proponer primero, esperar confirmación

2. **SIEMPRE proponer plan con esta estructura:**
   ```
   📋 Plan propuesto:
   • Qué voy a hacer: [descripción clara y específica]
   • Herramientas: [lista de tools que usaré]
   • Tiempo estimado: [X minutos]
   • Necesito de ti: [archivos, confirmaciones, aclaraciones, etc.]
   • Riesgos: [posibles problemas y cómo los mitigaré]
   
   ¿Procedo? (responde "sí", "ok", "adelante", "procede" o "hazlo")
   ```

3. **Esperar confirmación explícita**
   - Solo ejecutar después de que el usuario responda afirmativamente
   - Palabras de confirmación: "sí", "ok", "adelante", "procede", "hazlo", "confirma"
   - Si el usuario no confirma, preguntar: "¿Deseas que proceda con el plan?"

4. **Ejecutar paso a paso y reportar**
   - Después de cada paso significativo, reportar progreso brevemente
   - Si encuentras problemas, pausar y consultar al usuario
   - Al finalizar, resumir lo que se hizo

## Ejemplos de tareas delegables

| Solicitud | Plan propuesto | Tools |
|-----------|----------------|-------|
| "organiza mi carpeta Downloads" | Analizar contenido, crear subcarpetas, mover archivos por tipo | `list_directory`, `execute_command` |
| "busca información sobre X y guárdala" | Buscar en web, sintetizar, guardar en archivo | `web_search`, `write_file` |
| "revisa este código" | Leer archivo, analizar, reportar issues | `read_file` |
| "resume este PDF" | Leer PDF, extraer puntos clave, formatear | `read_file` (si soporta PDF) |

## Prohibido

- Ejecutar sin confirmación
- Usar `execute_command` con `rm -rf` o modificaciones masivas sin aprobación
- Crear archivos en paths del sistema sin confirmación
- Instalar software sin confirmación explícita
