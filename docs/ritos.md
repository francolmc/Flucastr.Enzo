# Ritos

## Los skills aprendidos de Enzo

Ritos es el sistema de skills de Enzo. Su responsabilidad es **convertir experiencia en capacidad reutilizable**.

## Principio

> Un Rito es un workflow que funcionó, convertido en conocimiento que Enzo puede usar de nuevo.

Sin Ritos, Enzo resuelve cada problema desde cero. Con Ritos, Enzo acumula capacidad con cada interacción — se vuelve más capaz cuanto más se usa.

## La diferencia con skills tradicionales

Los skills tradicionales (como en el v1 de Enzo o en OpenClaw) son archivos que el usuario crea manualmente — SKILL.md con instrucciones. Útiles, pero estáticos.

Los Ritos van más allá:
Skills tradicionales:
Usuario escribe SKILL.md → Enzo lo usa
Ritos:
Enzo resuelve algo bien → Enzo (o el usuario) lo convierte en Rito
→ Enzo lo reutiliza automáticamente la próxima vez

## Tipos de Ritos

**1. Ritos manuales**
El usuario define el Rito explícitamente:
"Enzo, cuando te pida preparar clase, siempre busca material actualizado
y guárdalo en ~/INACAP/[nombre-clase]/"

**2. Ritos aprendidos**
Enzo detecta un patrón exitoso y propone convertirlo en Rito:
Enzo: "He preparado tus clases 3 veces de la misma forma.
¿Quieres que lo convierta en un Rito automático?"

**3. Ritos de Echo**
Workflows que Echo ejecuta de forma autónoma y programada.

## Estructura de un Rito

```json
{
  "id": "preparar-clase-inacap",
  "name": "Preparar clase INACAP",
  "trigger": "cuando el usuario pide preparar una clase o material para INACAP",
  "steps": [
    "buscar material actualizado sobre el tema de la clase",
    "crear carpeta en ~/INACAP/[nombre-clase] si no existe",
    "guardar el material encontrado en esa carpeta",
    "confirmar al usuario qué se preparó"
  ],
  "usageCount": 7,
  "createdAt": 1234567890,
  "lastUsed": 1234567890
}
```

## Cómo se activa un Rito

El Planner, antes de decidir qué hacer, consulta Raíz por Ritos relevantes. Si encuentra uno que encaja con el mensaje del usuario, lo incluye como contexto adicional.
Usuario: "prepara el material para la clase de Python de mañana"
↓
Planner consulta Raíz: ¿hay un Rito para preparar clases?
↓
Raíz devuelve: Rito "preparar-clase-inacap"
↓
Planner usa los steps del Rito como guía
↓
Manos ejecuta cada step

El Rito no reemplaza el razonamiento del Planner — lo guía. El modelo sigue decidiendo, pero tiene un mapa de lo que funcionó antes.

## Cómo se crea un Rito

**Forma conversacional:**
Usuario: "Enzo, cada vez que te pida buscar noticias de IA,
guarda el resultado en ~/noticias-ia.md"
Enzo: "Entendido. He creado el Rito 'noticias-ia'.
La próxima vez que pidas noticias de IA, lo haré automáticamente."

**Forma automática (futuro):**
Enzo detecta que resolvió el mismo tipo de tarea 3+ veces y propone el Rito.

## Formato en disco

Los Ritos pueden vivir en Raíz (SQLite) o como archivos SKILL.md en `~/.enzo/skills/` — compatibles con el formato AgentSkills.io para interoperabilidad con otros asistentes.

```markdown
---
id: preparar-clase-inacap
name: Preparar clase INACAP
trigger: preparar clase, material INACAP, clase de mañana
usageCount: 7
---

Cuando el usuario pida preparar una clase:
1. Buscar material actualizado sobre el tema
2. Crear carpeta en ~/INACAP/[nombre-clase] si no existe
3. Guardar el material en esa carpeta
4. Confirmar qué se preparó
```

## Relación con Amplify

Los Ritos son la manifestación más clara del principio Amplify aplicado al aprendizaje:

- Un modelo pequeño resuelve un problema paso a paso ✓
- El resultado exitoso se convierte en Rito ✓
- La próxima vez, el modelo tiene un mapa — menos carga cognitiva ✓
- El asistente mejora sin necesitar un modelo más grande ✓

## Lo que Ritos NO hace

- No ejecuta automáticamente sin que el usuario lo pida
- No modifica su propia lógica sin confirmación del usuario
- No comparte Ritos entre usuarios
- No reemplaza el razonamiento del Planner

## Estado actual

- 🔄 No implementado en core v2
- ✅ Concepto parcial en v1 (Skills + MemoryLessons)
- 🔄 Pendiente para Semana 2 del roadmap

## Prioridad de implementación

1. Tabla `skills` en Raíz
2. Creación manual de Ritos via conversación
3. Inyección de Ritos relevantes en el contexto del Planner
4. Propuesta automática de Ritos basada en patrones de uso
5. Compatibilidad con formato AgentSkills.io

## El nombre

Ritos — porque son comportamientos que se repiten con intención. Un rito no es rutina ciega — es acción con propósito, refinada por la experiencia.

Cada vez que Enzo ejecuta un Rito, lo hace un poco mejor que la vez anterior.