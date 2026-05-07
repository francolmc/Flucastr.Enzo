---
name: teaching-materials-creator
description: |
  Crea materiales educativos profesionales de forma autónoma. Genera presentaciones,
  ejercicios, evaluaciones y controles de planificación para clases. Trabaja iterativamente
  hasta alcanzar calidad profesional y completitud.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: education
  tags: teaching, materials, presentations, exercises, planning, autonomous
allowed-tools: web_search write_file read_file recall
---

# Teaching Materials Creator - Creador de Materiales Educativos

## Pasos a seguir

1. **Análisis del requerimiento**: Extraer tema, nivel, duración y objetivos de aprendizaje
2. **Investigación**: Buscar contenido actualizado y mejores prácticas educativas
3. **Estructuración**: Diseñar esquema lógico y secuencia de contenido
4. **Creación de contenido**: Desarrollar materiales principales (presentación, ejercicios)
5. **Evaluación**: Crear instrumentos de medición de aprendizaje
6. **Control de planificación**: Diseñar sistema de seguimiento
7. **Refinamiento**: Iterar hasta alcanzar calidad profesional

## Formato de salida obligatorio

```
🎓 Creando Materiales Educativos

📚 Tema: [tema específico]
🎯 Nivel: [básico/intermedio/avanzado]
⏱️ Duración estimada: [X horas/clases]
👥 Audiencia: [descripción del público]

📋 Estructura propuesta:
   1. [Módulo 1] - [objetivo]
   2. [Módulo 2] - [objetivo]
   3. ...

🔍 Iniciando investigación y creación...
```

## Formato de progreso

```
📊 Progreso de Materiales - [X%]

✅ Completado:
   • Estructura y objetivos
   • Investigación inicial
   • [elemento completado]

🔄 Trabajando en:
   • [elemento actual] - [detalle específico]

📝 Archivos creados:
   • [archivo1] - [descripción]
   • [archivo2] - [descripción]

💡 Mejoras aplicadas:
   • [mejora 1]
   • [mejora 2]
```

## Formato de finalización

```
🎉 Materiales Educativos Completados

📋 Resumen del contenido:
   • Tema: [tema completo]
   • Módulos: [X módulos]
   • Ejercicios: [X ejercicios]
   • Evaluaciones: [X instrumentos]

📁 Archivos entregados:
   • 📄 Presentación: [nombre_archivo]
   • 📝 Ejercicios: [nombre_archivo]
   • 📊 Evaluación: [nombre_archivo]
   • 📅 Planificación: [nombre_archivo]

🎯 Objetivos de aprendizaje cubiertos:
   • [objetivo 1] - ✅
   • [objetivo 2] - ✅
   • ...

🏆 Calidad profesional alcanzada:
   • Contenido actualizado y relevante
   • Estructura pedagógica sólida
   • Ejercicios prácticos y aplicados
   • Sistema de evaluación completo

💡 Recomendaciones de uso:
   • [sugerencia 1]
   • [sugerencia 2]
```

## Tipos de materiales creados

### 1. Presentaciones Profesionales
- Diapositivas estructuradas con contenido visual
- Teoría explicada paso a paso
- Ejemplos prácticos y casos de uso
- Resúmenes y conclusiones

### 2. Ejercicios Prácticos
- Ejercicios graduados por dificultad
- Problemas reales y aplicados
- Guías de solución paso a paso
- Retroalimentación constructiva

### 3. Evaluaciones
- Cuestionarios de opción múltiple
- Problemas de desarrollo
- Proyectos prácticos
- Rúbricas de evaluación

### 4. Control de Planificación
- Cronograma detallado de clases
- Objetivos por sesión
- Recursos necesarios
- Indicadores de seguimiento

## Reglas de calidad

- **Precisión pedagógica**: Contenido educativamente sólido
- **Relevancia**: Material actualizado y aplicable
- **Claridad**: Explicaciones fáciles de entender
- **Practicidad**: Ejercicios realistas y útiles
- **Completitud**: Todos los temas cubiertos profundamente

## Plantillas y estructuras

### Estructura de presentación
```markdown
# [Título Principal]

## Objetivos de Aprendizaje
- [objetivo 1]
- [objetivo 2]

## Contenido
### [Módulo 1: Conceptos básicos]
- Definiciones
- Ejemplos
- Aplicaciones

### [Módulo 2: Aplicaciones prácticas]
- Casos de uso
- Ejercicios guiados

## Resumen
- Puntos clave
- Próximos pasos
```

### Estructura de ejercicios
```markdown
# Ejercicios - [Tema]

## Nivel Básico
1. [Ejercicio 1]
   - Objetivo: [skill desarrollada]
   - Dificultad: ⭐⭐

## Nivel Intermedio
2. [Ejercicio 2]
   - Objetivo: [skill desarrollada]
   - Dificultad: ⭐⭐⭐

## Soluciones
- [Solución detallada paso a paso]
```

## Ejemplos de activación

- "crea material para clase de algoritmos"
- "prepara presentación sobre bases de datos para nivel básico"
- "desarrolla ejercicios de programación para principiantes"
- "trabaja en mis clases de matemáticas hasta tener material completo"
- "crea control de planificación para curso de web development"

## Investigación y fuentes

### Fuentes de contenido
- Documentación oficial
- Tutoriales reconocidos
- Artículos académicos
- Mejores prácticas industriales

### Actualización constante
- Verificar vigencia del contenido
- Incluir ejemplos recientes
- Adaptar a nuevas tecnologías
- Incorporar feedback de estudiantes

## Integración con Autonomous Work Manager

### Delegación de tareas
```javascript
// El work manager delega creación de materiales
{
  task: "teaching_materials",
  topic: "algoritmos de ordenamiento",
  level: "intermedio",
  duration: "2 horas",
  deliverables: ["presentation", "exercises", "evaluation"]
}
```

### Reporte de progreso
- Enviar actualizaciones cada 30 minutos
- Informar sobre bloques o necesidades
- Solicitar aprobación para decisiones importantes

## Métricas de éxito

- **Completitud**: Todos los objetivos cubiertos
- **Calidad**: Material profesional y usable
- **Pedagogía**: Estructura educativa sólida
- **Practicidad**: Aplicable en clase real
- **Claridad**: Fácil de entender y enseñar
