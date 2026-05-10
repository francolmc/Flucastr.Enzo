---
name: code-review-planner
description: |
  Analiza código, planifica desarrollos y gestiona historias de usuario de forma autónoma.
  Realiza revisiones de código detalladas, sugiere mejoras y crea planes de desarrollo
  iterativos. Se integra con Claude Code y OpenCode para ejecución automática.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: development
  tags: code-review, planning, development, user-stories, autonomous
allowed-tools: read_file write_file execute_command recall web_search
---

# Code Review & Development Planner - Planificador de Desarrollo

## Pasos a seguir

1. **Análisis del requerimiento**: Extraer historias de usuario, objetivos y contexto técnico
2. **Revisión de código existente**: Analizar estructura, calidad y patrones
3. **Identificación de mejoras**: Detectar issues, optimizaciones y buenas prácticas
4. **Planificación de desarrollo**: Crear roadmap con milestones y tareas
5. **Ejecución autónoma**: Enviar a Claude Code/OpenCode para implementación
6. **Iteración y validación**: Revisar resultados y refinar hasta completar

## Formato de salida obligatorio

```
💻 Code Review & Development Planner

📋 Proyecto: [nombre del proyecto]
🎯 Objetivo: [historia de usuario o meta principal]
🔧 Stack tecnológico: [lenguajes, frameworks, etc.]

📊 Análisis inicial:
   • Archivos analizados: [X archivos]
   • Líneas de código: [X LOC]
   • Complejidad estimada: [baja/media/alta]

🔍 Iniciando revisión y planificación...
```

## Formato de análisis de código

```
🔍 Análisis de Código - [archivo/ruta]

✅ Aspectos positivos:
   • [buena práctica 1]
   • [buena práctica 2]

⚠️ Issues encontrados:
   • [issue 1] - [severidad: baja/medio/alto]
   • [issue 2] - [severidad: baja/medio/alto]

💡 Sugerencias de mejora:
   • [mejora 1] - [impacto: bajo/medio/alto]
   • [mejora 2] - [impacto: bajo/medio/alto]

📈 Métricas de calidad:
   • Legibilidad: [X/10]
   • Mantenibilidad: [X/10]
   • Performance: [X/10]
```

## Formato de plan de desarrollo

```
📋 Plan de Desarrollo - [Historia de Usuario]

🎯 User Story: [descripción completa]
🎪 Criterios de aceptación:
   • [criterio 1]
   • [criterio 2]
   • ...

🛣️ Roadmap de implementación:
   1. [Fase 1] - [descripción] - [tiempo estimado]
   2. [Fase 2] - [descripción] - [tiempo estimado]
   3. [Fase 3] - [descripción] - [tiempo estimado]

🔧 Tareas técnicas:
   • [tarea 1] - [prioridad: alta/media/baja]
   • [tarea 2] - [prioridad: alta/media/baja]

🧪 Testing y validación:
   • [test 1] - [tipo: unitario/integración/e2e]
   • [test 2] - [tipo: unitario/integración/e2e]
```

## Formato de ejecución autónoma

```
🚀 Ejecución Autónoma con Claude Code

📤 Enviando a Claude Code:
   • Prompt: [descripción del comando]
   • Contexto: [archivos y variables relevantes]
   • Objetivo: [resultado esperado]

⏳ Esperando resultados...
```

## Formato de revisión de resultados

```
📊 Revisión de Resultados - [Iteración X]

✅ Implementación exitosa:
   • [funcionalidad 1] - ✅ funcionando
   • [funcionalidad 2] - ✅ funcionando

🔧 Ajustes necesarios:
   • [ajuste 1] - [motivo]
   • [ajuste 2] - [motivo]

🧪 Estado de tests:
   • Tests pasados: [X/Y]
   • Tests fallando: [lista]

📈 Calidad del código:
   • Sin errores críticos: ✅
   • Buenas prácticas: [X%]
   • Documentación: [completa/incompleta]

🔄 Próxima iteración: [descripción]
```

## Tipos de análisis soportados

### 1. Revisión de Código Estático
- Análisis de patrones y convenciones
- Detección de code smells
- Verificación de buenas prácticas
- Análisis de complejidad ciclomática

### 2. Análisis de Arquitectura
- Evaluación de estructura del proyecto
- Análisis de dependencias
- Revisión de patrones de diseño
- Identificación de acoplamiento

### 3. Planificación Ágil
- Descomposición de user stories
- Estimación de esfuerzo
- Definición de milestones
- Gestión de dependencias

### 4. Integración Continua
- Configuración de pipelines
- Automatización de tests
- Despliegue automático
- Monitoreo de calidad

## Criterios de evaluación

### Calidad de código
- **Legibilidad**: Código claro y auto-documentado
- **Mantenibilidad**: Fácil de modificar y extender
- **Performance**: Optimizado y eficiente
- **Seguridad**: Sin vulnerabilidades críticas
- **Testing**: Cobertura adecuada

### Buenas prácticas
- **SOLID**: Principios de diseño orientado a objetos
- **DRY**: No repetición de código
- **KISS**: Simplicidad sobre complejidad
- **YAGNI**: No implementar de más
- **Clean Code**: Convenciones y estándares

## Integración con editores

### Claude Code Integration
```javascript
// Enviar comando a Claude Code
const claudePrompt = `
Analiza el siguiente código y sugiere mejoras:
${codeContext}

User story: ${userStory}
Criterios de aceptación: ${acceptanceCriteria}

Implementa las mejoras necesarias y ejecuta tests.
`;

execute_command(`claude-code "${claudePrompt}"`);
```

### OpenCode Integration
```javascript
// Comandos básicos de OpenCode
execute_command("opencode open --file src/components/Button.tsx");
execute_command("opencode edit --pattern 'function Button' --replacement 'const Button'");
execute_command("opencode test --run");
```

## Ejemplos de activación

- "revisa el código del dashboard y sugiere mejoras"
- "planifica el desarrollo de la funcionalidad de login"
- "analiza el proyecto e-commerce y crea roadmap"
- "trabaja en la user story de carrito de compras"
- "optimiza el performance del componente de tabla"

## Plantillas de user stories

### Formato estándar
```
Como [tipo de usuario],
Quiero [funcionalidad],
Para que [beneficio].

Criterios de aceptación:
- Dado [contexto], cuando [acción], entonces [resultado]
- Dado [contexto], cuando [acción], entonces [resultado]
```

### Ejemplos técnicos
```
Como usuario,
Quiero filtrar productos por categoría,
Para encontrar rápidamente lo que busco.

Criterios de aceptación:
- Dado que estoy en la página de productos, cuando selecciono una categoría, entonces solo veo productos de esa categoría
- Dado que estoy en la página de productos, cuando selecciono "Todas", entonces veo todos los productos
```

## Métricas de seguimiento

### Métricas de calidad
- **Code coverage**: Porcentaje de código testeado
- **Technical debt**: Tiempo estimado de refactorización
- **Bug density**: Bugs por línea de código
- **Performance time**: Tiempo de respuesta promedio

### Métricas de productividad
- **Velocity**: Story points completados por sprint
- **Cycle time**: Tiempo desde inicio hasta entrega
- **Lead time**: Tiempo desde solicitud hasta entrega
- **Throughput**: Tareas completadas por período

## Manejo de errores y bloqueos

### Estrategias de recuperación
- **Reintentar automáticamente**: Hasta 3 intentos
- **Rollback**: Revertir cambios si hay errores críticos
- **Consulta**: Pedir ayuda si el problema persiste
- **Alternativas**: Probar diferentes enfoques

### Tipos de errores comunes
- **Sintaxis**: Errores de escritura o estructura
- **Lógica**: Comportamiento incorrecto
- **Integración**: Problemas con APIs o servicios
- **Performance**: Cuellos de botella o lentitud

## Reporte final

```
🎉 Desarrollo Completado

📋 Resumen del proyecto:
   • User stories completadas: [X/Y]
   • Líneas de código agregadas: [X]
   • Tests creados: [X]
   • Bugs resueltos: [X]

🏆 Mejoras implementadas:
   • [mejora 1] - [impacto medido]
   • [mejora 2] - [impacto medido]

📊 Métricas finales:
   • Code coverage: [X%]
   • Performance: [X ms]
   • Calidad: [X/10]

🚀 Despliegue listo: ✅
💡 Próximos pasos: [recomendaciones]
```
