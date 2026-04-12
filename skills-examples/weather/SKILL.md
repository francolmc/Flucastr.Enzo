---
name: weather
description: >
  Úsame SOLO cuando el usuario pregunte explícitamente por temperatura,
  clima, tiempo atmosférico, pronóstico, lluvia, viento, humedad o
  condiciones meteorológicas de una ciudad o región específica.
  NO me uses para preguntas generales, noticias, eventos o cualquier
  otra cosa que no sea clima actual o pronóstico.
version: 5.0.0
author: enzo-team
steps:
  - id: geocoding
    description: >
      Geocodificar la ciudad con Open-Meteo usando curl -sG con --data-urlencode
      para obtener latitude y longitude. Nunca interpolar ciudad con acentos en la URL.
    tool: execute_command
  - id: forecast
    description: >
      Consultar clima actual con Open-Meteo forecast usando las coordenadas
      obtenidas en el paso anterior (latitude, longitude). Extraer temperature_2m,
      apparent_temperature, relative_humidity_2m, wind_speed_10m, weather_code.
    tool: execute_command
---

# Weather Skill - Clima con Open-Meteo

## Cuándo Usar Este Skill

SOLO cuando el usuario pregunte por:
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
- Geocodificación fallback (si Open-Meteo no retorna `results`):
  `https://nominatim.openstreetmap.org/search?q=[ciudad_url_encoded],[pais_url_encoded]&format=jsonv2&limit=1&addressdetails=1`
- Clima actual (coordenadas -> condiciones actuales):
  `https://api.open-meteo.com/v1/forecast?latitude=[lat]&longitude=[lon]&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`

Ejemplos:
- Madrid, España (geocodificación):
  `https://geocoding-api.open-meteo.com/v1/search?name=Madrid&count=1&language=es&format=json`
- Buenos Aires, Argentina (geocodificación):
  `https://geocoding-api.open-meteo.com/v1/search?name=Buenos%20Aires&count=1&language=es&format=json`
- Clima actual para coordenadas de ejemplo:
  `https://api.open-meteo.com/v1/forecast?latitude=-34.61&longitude=-58.38&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`

## Cómo Obtener los Datos

**IMPORTANTE: Debes usar la herramienta disponible en runtime (normalmente `execute_command`) para hacer `curl` a Open-Meteo.**
Si existe `web_fetch` en tu runtime, también se puede usar.

**REGLA OBLIGATORIA:** Geocoding (`/v1/search`) **solo** sirve para encontrar coordenadas.
**Nunca** respondas el clima usando únicamente geocoding.
Para responder clima, debes consultar también `/v1/forecast` con `current=...`.

Paso 1: geocodifica la ciudad para obtener latitud y longitud (forma segura):
```
execute_command:
curl -sG 'https://geocoding-api.open-meteo.com/v1/search' \
  --data-urlencode 'name=[ciudad]' \
  --data 'count=5' \
  --data 'language=es' \
  --data 'format=json'
```

Extrae coordenadas desde:
- Open-Meteo: `results[0].latitude` y `results[0].longitude`
- País/ciudad sugeridos: `results[0].name`, `results[0].country`

Si Open-Meteo no devuelve `results`, usa fallback:
```
execute_command:
curl -sG 'https://nominatim.openstreetmap.org/search' \
  --data-urlencode 'q=[ciudad],[pais]' \
  --data 'format=jsonv2' \
  --data 'limit=1' \
  --data 'addressdetails=1'
```

Extrae coordenadas fallback desde:
- Nominatim: `lat` y `lon` del primer elemento del array

Paso 2: con esas coordenadas, consulta el clima actual:
```
execute_command:
curl -sG 'https://api.open-meteo.com/v1/forecast' \
  --data 'latitude=[lat]' \
  --data 'longitude=[lon]' \
  --data 'current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' \
  --data 'timezone=auto'
```

Si falta el paso 2, la respuesta está incompleta y no debe enviarse al usuario.

**NO inventes datos. SIEMPRE usa resultados reales de Open-Meteo.**

Reglas de robustez para geocoding:
- Nunca interpolar ciudad directo en URL si puede tener acentos (ej: `Copiapó`)
- Usar siempre `curl -G --data-urlencode` para `name`/`q`
- Si la ciudad es ambigua, incluir país (`Santiago, Chile`)
- Reintentar sin acentos (`México` -> `Mexico`) si no hay resultados
- Si la respuesta contiene `<html>` o `403 Forbidden`, repetir con ciudad normalizada (sin acentos)
- Si todavía falla, pedir al usuario ciudad + país

### Información que proporciona Open-Meteo

Open-Meteo ofrece en su API:
- Temperatura actual en °C
- "Sensación térmica" /  "Se siente como"
- Código de clima (`weather_code`) a convertir a descripción en español
- Humedad relativa (%)
- Velocidad del viento (km/h)
- (Opcional) Pronóstico próximos días agregando parámetros de `daily`

## Estrategia de Búsqueda

1. **Intento principal:** geocodificación con Open-Meteo para [ciudad]
2. **Si la ciudad no se encuentra:** intenta con formato "ciudad, país"
3. **Si sigue sin resultados:** reintenta sin acentos y con `language=en`
4. **Fallback final de geocoding:** usa Nominatim con `q=ciudad,pais`

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

Se deben remplazar los valores del clima obtenidos en cada [XX] según corresponda.

Convierte `weather_code` a texto en español:
- `0` → Despejado
- `1,2,3` → Parcialmente nublado / Nublado
- `45,48` → Niebla
- `51,53,55` → Llovizna
- `61,63,65` → Lluvia
- `71,73,75` → Nieve
- `95` → Tormenta

## Flujo Paso a Paso

1. Extrae la ciudad (y país si es necesario) del mensaje del usuario
2. URL-encode de ciudad/país antes de llamar APIs
3. Llama a Open-Meteo geocoding para obtener latitud/longitud
4. Si Open-Meteo no devuelve `results`, usa fallback Nominatim
5. Si ningún geocoder retorna coordenadas, pide más precisión (ciudad + país) y no inventes
6. Llama al endpoint de clima actual con latitud/longitud (**obligatorio antes de responder**)
7. Verifica que exista `current` en la respuesta de forecast
8. Extrae del JSON:
   - Temperatura actual en °C
   - Sensación térmica
   - `weather_code` y conviértelo a descripción (Despejado, Nublado, Lluvia, etc.)
   - Humedad (%)
   - Velocidad del viento (km/h)
9. Presenta con el formato estándar
10. Si no hay datos, sé honesto: *"No pude obtener información actualizada para [ciudad]"*

## Validación Antes de Responder

Checklist obligatorio:
- [ ] ¿Se llamó a geocoding con `curl -G --data-urlencode`?
- [ ] ¿Si Open-Meteo falló, se intentó fallback de geocoding?
- [ ] ¿Se llamó a forecast con esas coordenadas?
- [ ] ¿Se leyó `current.temperature_2m` y no solo datos de ubicación?
- [ ] ¿La respuesta final incluye datos meteorológicos reales y no solo coordenadas?

## Notas

- **No inventes datos** — usa solo lo que devuelvan los endpoints de Open-Meteo vía web_fetch
- **Open-Meteo es confiable** — API pública, estable y ampliamente usada
- **Geocoding con fallback** — si Open-Meteo falla, usa Nominatim para no cortar el flujo
- **Error 403 típico** — suele pasar por acentos sin encoding en querystring; corrige con `--data-urlencode`
- **Normaliza condiciones** — siempre convierte `weather_code` a descripción legible en español
- **Manejo de ciudades que no existen** — si geocoding no retorna resultados, avisa al usuario que necesita especificar más o que la ciudad no está disponible
