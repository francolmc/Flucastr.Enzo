---
name: afternoon-prep
description: |
  Preparación para clases o reuniones importantes. Revisa el material necesario,
  verifica el calendario de la tarde, y ayuda a organizar lo que se necesita antes de salir.
  Úsalo cuando el usuario diga "me voy a clases", "prepárame para la reunión",
  "qué necesito para la tarde" o solicite preparación para actividades pendientes.
version: "1.0.0"
license: MIT
metadata:
  author: enzo-org
  category: productivity
  tags: afternoon, prep, classes, meetings, routine
allowed-tools: calendar recall read_file list_directory
---

# Preparación para la Tarde - Afternoon Prep

## Pasos a seguir

1. **Calendario tarde**: Usar `calendar` para ver eventos de la tarde (desde hora actual en adelante)
2. **Material**: Usar `recall` para buscar "material clases" o "prep reunión"
3. **Archivos**: Si hay mención de archivos específicos, usar `read_file` o `list_directory`
4. **Pendientes urgentes**: Verificar si hay algo que completar antes de salir

## Formato de salida obligatorio

```
🎒 Preparación para la Tarde

📅 Eventos próximos:
   • [hora] - [evento 1] - [ubicación/sala si aplica]
   • [hora] - [evento 2] - [ubicación/sala si aplica]

📚 Material necesario:
   • [item 1]
   • [item 2]
   • ...

⚠️ Pendientes urgentes antes de salir:
   • [tarea urgente 1] - [tiempo estimado]
   • ... (o "Nada urgente" si no hay)

⏰ Debes salir aproximadamente: [hora calculada]

💡 Recordatorio: [consejo específico para los eventos de hoy]
```

## Reglas

- Calcular hora de salida basándote en primer evento menos tiempo de traslado
- Si no hay eventos específicos, indicar "Sin eventos agendados"
- Material: buscar keywords como "clase", "reunión", "presentación", "examen"
- Incluir ubicación/sala si está disponible en el calendario
- Mantener tono de apoyo, no presionar innecesariamente

## Ejemplos de activación

- "me voy a clases"
- "prepárame para la reunión"
- "qué necesito para la tarde"
- "revisión antes de salir"
- "qué tengo pendiente antes de las clases"
