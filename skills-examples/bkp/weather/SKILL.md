---
name: weather
description: >
  Proporciona información meteorológica actual y pronóstico del tiempo
  para una ubicación específica. Incluye temperatura, condiciones climáticas,
  humedad, viento y sensación térmica. Úsala cuando el usuario pregunte
  por el clima, temperatura o condiciones meteorológicas de una ciudad.
version: 5.0.0
author: enzo-team
---

# Weather Skill - Clima con Open-Meteo

## Cuándo Usar Esta Skill

Cuando el usuario pregunte por:
- Temperatura actual en una ciudad o región
- Condiciones climáticas (soleado, nublado, lluvia, etc.)
- Pronóstico del tiempo (hoy, mañana, próximos días)
- Humedad, viento, sensación térmica, índice UV

NO usar para:
- Preguntas sobre clima laboral, económico o social
- Noticias relacionadas con fenómenos climáticos pasados
- Cualquier consulta que no sea meteorológica

## Fuente de Datos

**Fuente principal:** Open-Meteo — API meteorológica pública y confiable, sin necesidad de API key.

URLs base:
- Geocodificación (ciudad -> coordenadas):
  `https://geocoding-api.open-meteo.com/v1/search?name=[ciudad_url_encoded]&count=5&language=es&format=json`
- Clima actual (coordenadas -> condiciones actuales):
  `https://api.open-meteo.com/v1/forecast?latitude=[lat]&longitude=[lon]&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`

## Cómo Obtener los Datos

Usa la herramienta `execute_command` para hacer `curl` a Open-Meteo.

Paso 1: Geocodifica la ciudad para obtener latitud y longitud:
```
curl -sG 'https://geocoding-api.open-meteo.com/v1/search' \
  --data-urlencode 'name=[ciudad]' \
  --data 'count=5' \
  --data 'language=es' \
  --data 'format=json'
```

Extrae coordenadas desde: `results[0].latitude` y `results[0].longitude`

Paso 2: Consulta el clima actual con las coordenadas:
```
curl -sG 'https://api.open-meteo.com/v1/forecast' \
  --data 'latitude=[lat]' \
  --data 'longitude=[lon]' \
  --data 'current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' \
  --data 'timezone=auto'
```

**NO inventes datos. SIEMPRE usa resultados reales de Open-Meteo.**

## Cómo Presentar el Resultado

```
**Clima en [Ciudad], [País]**

🌡️ Temperatura: [XX]°C
🌤️ Condición: [Descripción en español]
🤔 Sensación térmica: [XX]°C
💧 Humedad: [XX]%
💨 Viento: [XX] km/h

💡 [Recomendación contextual: paraguas, abrigo, protector solar, etc.]
```

Convierte `weather_code` a texto en español:
- `0` → Despejado
- `1,2,3` → Parcialmente nublado / Nublado
- `45,48` → Niebla
- `51,53,55` → Llovizna
- `61,63,65` → Lluvia
- `71,73,75` → Nieve
- `95` → Tormenta

Ejemplos de uso:
- "qué tiempo hace en Madrid"
- "dime el clima de Buenos Aires"
- "lloverá mañana en Santiago"
- "qué temperatura tiene Lima ahora"