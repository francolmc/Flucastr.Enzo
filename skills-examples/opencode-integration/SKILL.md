---
name: opencode-integration
description: |
  Integración básica con OpenCode para comandos de edición y navegación de proyectos.
  Permite abrir archivos, realizar ediciones simples, navegar estructuras y sincronizar
  cambios. Funciona como complemento a Claude Code para tareas rápidas.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: development
  tags: opencode, editor, integration, files, navigation
allowed-tools: execute_command read_file write_file list_directory
---

# OpenCode Integration - Integración con OpenCode

## Pasos a seguir

1. **Verificar instalación**: Confirmar que OpenCode está disponible
2. **Navegación de proyecto**: Explorar estructura de archivos y directorios
3. **Operaciones de archivo**: Abrir, leer, editar y guardar archivos
4. **Ediciones rápidas**: Realizar cambios simples y directos
5. **Sincronización**: Guardar cambios y mantener consistencia
6. **Validación**: Verificar que los cambios funcionen correctamente

## Formato de salida obligatorio

```
🔧 OpenCode Integration Activado

📋 Proyecto actual: [ruta del proyecto]
🔍 OpenCode disponible: ✅/❌
📁 Estructura detectada: [tipo de proyecto]

🛠️ Operaciones disponibles:
   • Navegación de archivos
   • Edición básica
   • Búsqueda y reemplazo
   • Sincronización de cambios

🚀 Iniciando operaciones...
```

## Comandos soportados

### Navegación y exploración
```bash
# Listar archivos en directorio
opencode ls --path [ruta]

# Abrir archivo específico
opencode open --file [ruta/archivo]

# Buscar archivos por patrón
opencode find --pattern "*.js" --path src/

# Mostrar estructura de proyecto
opencode tree --max-depth 3
```

### Edición de archivos
```bash
# Editar archivo completo
opencode edit --file [ruta] --content "[nuevo contenido]"

# Reemplazar patrón específico
opencode replace --file [ruta] --pattern "[patrón]" --replacement "[reemplazo]"

# Insertar línea en posición específica
opencode insert --file [ruta] --line [número] --content "[contenido]"

# Eliminar líneas
opencode delete --file [ruta] --start [inicio] --end [fin]
```

### Operaciones de proyecto
```bash
# Crear nuevo archivo
opencode create --file [ruta] --content "[contenido inicial]"

# Copiar archivo
opencode copy --source [origen] --dest [destino]

# Mover/renombrar archivo
opencode move --source [origen] --dest [destino]

# Eliminar archivo
opencode delete --file [ruta]
```

## Formato de operación ejecutada

```
✅ Operación Completada

🔧 Comando: [comando ejecutado]
📁 Archivo: [ruta del archivo]
⏱️ Duración: [X segundos]

📊 Resultado:
   • Líneas modificadas: [X]
   • Cambios aplicados: [descripción]
   • Estado: [exitoso/con advertencias]

📝 Detalles:
   • [detalle 1]
   • [detalle 2]
```

## Casos de uso típicos

### 1. Corrección rápida de bugs
```bash
# Ejemplo: Corregir import incorrecto
opencode replace --file src/utils/helpers.js \
  --pattern "import { helper } from './helper'" \
  --replacement "import { helper } from './helpers'"
```

### 2. Adición de funcionalidad
```bash
# Ejemplo: Agregar nueva función
opencode insert --file src/api/users.js \
  --line 15 \
  --content "
export const getUserById = async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
};"
```

### 3. Refactorización
```bash
# Ejemplo: Renombrar componente
opencode move --source src/components/OldButton.jsx \
  --dest src/components/NewButton.jsx

opencode replace --file src/components/NewButton.jsx \
  --pattern "OldButton" \
  --replacement "NewButton"
```

## Integración con otros skills

### Con Code Review Planner
```javascript
// El planner solicita correcciones
{
  action: "fix_issue",
  file: "src/components/Button.jsx",
  issue: "Missing accessibility props",
  fix: "Add aria-label and role attributes"
}

// OpenCode ejecuta la corrección
execute_command(`opencode replace --file src/components/Button.jsx \
  --pattern "<button" \
  --replacement "<button aria-label='Submit button' role='button'"`);
```

### Con Autonomous Work Manager
```javascript
// El work manager delega tareas de edición
{
  task: "file_operations",
  operations: [
    { type: "create", file: "README.md", content: "# Project Title" },
    { type: "edit", file: "package.json", changes: [...] },
    { type: "move", source: "old.js", dest: "new.js" }
  ]
}
```

## Manejo de errores

### Errores comunes y soluciones
```bash
# Archivo no encontrado
❌ Error: File not found
✅ Solución: Verificar ruta y usar opencode ls para explorar

# Permisos insuficientes
❌ Error: Permission denied
✅ Solución: Verificar permisos del archivo/directorio

# Sintaxis incorrecta
❌ Error: Invalid syntax
✅ Solución: Validar comando y parámetros

# Archivo en uso
❌ Error: File is locked
✅ Solución: Cerrar archivo en editor y reintentar
```

### Estrategias de recuperación
1. **Verificar estado**: `opencode status`
2. **Revertir cambios**: `opencode revert --file [ruta]`
3. **Backup automático**: Guardar versión antes de editar
4. **Validación post-edición**: Verificar sintaxis/funcionalidad

## Buenas prácticas

### Antes de editar
- Siempre hacer backup del archivo original
- Verificar sintaxis actual del archivo
- Confirmar que el archivo no está bloqueado
- Revisar dependencias afectadas

### Durante la edición
- Usar patterns específicos para evitar cambios no deseados
- Validar cada cambio antes de aplicar el siguiente
- Mantener consistencia en estilo y formato
- Documentar cambios complejos

### Después de editar
- Verificar que el archivo compile/ejecute
- Probar funcionalidad afectada
- Actualizar documentación relacionada
- Commit de cambios con mensaje descriptivo

## Formato de reporte de progreso

```
📊 Progreso de Edición - [X% completado]

✅ Operaciones realizadas:
   • [operación 1] - [archivo] - ✅
   • [operación 2] - [archivo] - ✅

🔄 Trabajando en:
   • [operación actual] - [progreso %]

⚠️ Advertencias:
   • [advertencia 1] - [impacto]

📁 Archivos modificados:
   • [archivo 1] - [tipo de cambio]
   • [archivo 2] - [tipo de cambio]

⏱️ Tiempo restante estimado: [X minutos]
```

## Ejemplos de activación

- "abre el archivo src/components/Button.jsx"
- "reemplaza 'console.log' por 'logger.info' en todos los archivos JS"
- "crea un nuevo componente llamado LoadingSpinner"
- "mueve el archivo utils.js a la carpeta helpers"
- "agrega export default al final del archivo config.js"

## Comandos avanzados

### Búsqueda y reemplazo múltiple
```bash
# Reemplazar en múltiples archivos
opencode replace-all --pattern "oldFunction" \
  --replacement "newFunction" \
  --files "**/*.js"

# Reemplazo con expresiones regulares
opencode replace --file src/app.js \
  --pattern "function (\w+)\(" \
  --replacement "const $1 = ("
```

### Operaciones batch
```bash
# Formatear múltiples archivos
opencode format --files "src/**/*.js" --style "prettier"

# Agregar header a todos los archivos
opencode add-header --files "src/**/*.js" \
  --content "// Copyright 2024 - All rights reserved"
```

## Métricas de uso

### Estadísticas de operaciones
- **Archivos editados**: X archivos
- **Líneas modificadas**: X líneas
- **Tiempo total**: X minutos
- **Tasa de éxito**: X%

### Optimización de rendimiento
- Usar patrones específicos para búsquedas
- Limitar operaciones a archivos necesarios
- Agrupar cambios relacionados
- Evitar operaciones redundantes

## Limitaciones conocidas

- **Ediciones complejas**: Mejor usar Claude Code para refactorizaciones grandes
- **Archivos binarios**: No soporta edición de imágenes, PDFs, etc.
- **Archivos muy grandes**: Puede tener problemas con archivos >10MB
- **Concurrente**: No manejar múltiples ediciones simultáneas del mismo archivo
