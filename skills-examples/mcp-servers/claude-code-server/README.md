# Claude Code MCP Server

Servidor MCP (Model Context Protocol) para integrar Claude Code con Enzo, permitiendo desarrollo autónomo e iterativo basado en historias de usuario.

## Características

- **Ejecución de comandos**: Enviar prompts a Claude Code y recibir resultados
- **Sesiones persistentes**: Mantener conversaciones continuas
- **Desarrollo iterativo**: Implementar user stories con múltiples iteraciones
- **Gestión de recursos**: Control automático de procesos y limpieza

## Instalación

```bash
cd skills-examples/mcp-servers/claude-code-server
npm install
npm run build
```

## Configuración en Enzo

Agregar al archivo `~/.enzo/config.json`:

```json
{
  "system": {
    "mcpServers": {
      "claude-code": {
        "command": "node",
        "args": ["/ruta/al/proyecto/skills-examples/mcp-servers/claude-code-server/dist/index.js"]
      }
    }
  }
}
```

## Herramientas disponibles

### claude_code_execute
Ejecuta un comando en Claude Code con contexto adicional.

```javascript
{
  "prompt": "Implement user authentication",
  "context": "Files: auth.js, routes.js\nDatabase: PostgreSQL",
  "working_directory": "/project/src",
  "session_id": "session_123" // opcional
}
```

### claude_code_create_session
Crea una nueva sesión para trabajo continuo.

```javascript
{
  "working_directory": "/project/src"
}
```

### claude_code_end_session
Finaliza una sesión y libera recursos.

```javascript
{
  "session_id": "session_123"
}
```

### claude_code_get_status
Obtiene estado de todas las sesiones activas.

### claude_code_iterate_development
Desarrollo iterativo basado en user stories.

```javascript
{
  "user_story": "Como usuario, quiero iniciar sesión con email y contraseña",
  "acceptance_criteria": [
    "Validar formato de email",
    "Verificar contraseña en base de datos",
    "Redirigir al dashboard después del login",
    "Mostrar error si credenciales son inválidas"
  ],
  "max_iterations": 5,
  "working_directory": "/project/src"
}
```

## Uso con Enzo Skills

### Autonomous Work Manager
```javascript
// Delegar desarrollo autónomo
const result = await tools.call("claude_code_iterate_development", {
  user_story: "Implementar carrito de compras",
  acceptance_criteria: [
    "Agregar productos al carrito",
    "Ver resumen del carrito",
    "Actualizar cantidades",
    "Calcular total"
  ],
  max_iterations: 3,
  working_directory: "/project"
});
```

### Code Review Planner
```javascript
// Solicitar mejoras de código
const review = await tools.call("claude_code_execute", {
  prompt: "Review this code and suggest improvements",
  context: codeContent,
  working_directory: "/project/src"
});
```

## Flujo de trabajo típico

1. **Crear sesión**: `claude_code_create_session`
2. **Ejecutar comandos**: `claude_code_execute` o `claude_code_iterate_development`
3. **Monitorear progreso**: `claude_code_get_status`
4. **Finalizar**: `claude_code_end_session`

## Manejo de errores

- **Sesión no encontrada**: Verificar que el session_id sea correcto
- **Claude Code no disponible**: Confirmar que Claude Code está instalado y en PATH
- **Timeout**: Ajustar timeouts según complejidad de las tareas
- **Permisos**: Verificar permisos de lectura/escritura en directorios

## Métricas y monitoreo

El servidor proporciona:
- Número de sesiones activas
- Tiempo de ejecución por comando
- Tasa de éxito/fallo
- Uso de recursos

## Limitaciones

- Requiere Claude Code instalado localmente
- Timeout de 30 segundos por comando
- Máximo 5 iteraciones en desarrollo iterativo
- Una sesión por directorio de trabajo

## Troubleshooting

### Claude Code no encontrado
```bash
# Verificar instalación
which claude-code

# Instalar si no está disponible
npm install -g @anthropic-ai/claude-code
```

### Sesiones no responden
```bash
# Verificar procesos activos
ps aux | grep claude-code

# Forzar limpieza
# Reiniciar Enzo o esperar timeout automático
```

### Permisos insuficientes
```bash
# Verificar permisos del directorio
ls -la /project/directory

# Ajustar permisos si es necesario
chmod 755 /project/directory
```
