# Enzo Core SLOs y Recomendaciones

Fecha: 2026-04-20  
Alcance: core base de Enzo (sin agentes/skills): mensaje, razonamiento/contexto, descomposición, reintentos, herramientas, respuesta y memoria.

## SLOs propuestos

- **Disponibilidad core:** `>= 99.5%` de requests completados sin error fatal del orquestador.
- **Exito funcional E2E:**
  - `SIMPLE`: `>= 99%`
  - `MODERATE` (1 tool): `>= 97%`
  - `COMPLEX` (2+ pasos): `>= 92%`
- **Latencia p95:**
  - `SIMPLE`: `< 4s`
  - `MODERATE`: `< 10s`
  - `COMPLEX`: `< 25s`
- **Validez de tool-calls:** `>= 97%` de llamadas con schema valido en primer intento.
- **Recuperacion por retry:** `>= 70%` de fallos transitorios recuperados por retry automatico.
- **Precision de memoria (recall):** `>= 95%` en hechos personales simples.
- **Calidad de respuesta:** `>= 95%` sin salida tecnica cruda innecesaria.
- **Regresiones criticas por release:** `0`.

## KPIs operativos a medir

- `core_request_total`, `core_request_failed_total`
- `core_latency_ms` (p50/p95/p99 por nivel de complejidad)
- `tool_calls_total`, `tool_calls_failed_total`
- `tool_input_validation_fail_total`
- `provider_retry_total`, `provider_retry_recovered_total`
- `classification_distribution` (`SIMPLE/MODERATE/COMPLEX`)
- `memory_extract_total`, `memory_extract_failed_total`
- `memory_recall_hit_rate`
- `fallback_response_total`

## Recomendaciones de mejora (priorizadas)

### P1 - Critico / corto plazo

- Mejorar UX del fast-path para no devolver output crudo de `execute_command`/`read_file` cuando no sea necesario.
- Agregar observabilidad por etapa (`think/act/observe/synthesize`) con `requestId` correlacionable.
- Endurecer validacion de input de herramientas con contratos estrictos y errores normalizados.
- Implementar circuit breaker por provider, ademas de retry/backoff.

### P2 - Alto impacto

- Ejecutar pruebas de caos controlado (429/5xx/timeouts intermitentes) y validar recuperacion.
- Mejorar guardrails de memoria (anti-poisoning y score de confianza por hecho extraido).
- Mantener dataset fijo de regresion con prompts reales y gate de release obligatorio.

### P3 - Optimizacion continua

- Afinar clasificacion para reducir falsos `COMPLEX`/`MODERATE`.
- Aplicar truncado/resumen inteligente para salidas largas sin perder datos clave.
- Configurar alertas automaticas para latencia p95, fallos de tools y baja recuperacion por retry.

## Criterio de "core confiable"

Se considera "confiable en produccion" cuando:

1. Cumple SLOs en staging durante 2 semanas consecutivas.
2. Cumple SLOs en produccion durante al menos 1 semana.
3. No presenta regresiones criticas en la suite de core antes de deploy.

## Estado actual (resumen ejecutivo)

- El core base esta solido para el flujo principal.
- Se reforzo resiliencia con retry/backoff en providers.
- Se igualo extraccion de memoria entre Telegram y Web API.
- Aun existe oportunidad de mejorar la presentacion de respuestas en ciertos fast-paths.
