# Observabilidad Local de Aplicaciones

KuaDashboard incluye una vista APM local en **Observabilidad > Aplicaciones**. Agrupa funciones AWS Lambda y workloads de Kubernetes confirmados en aplicaciones, sin instalar agentes ni crear recursos cloud.

## Fuentes de Datos

- **Lambda**: KUA lee CloudWatch Logs con `FilterLogEvents` y extrae agregados de las líneas `REPORT` de Lambda. Un ciclo de recolección lee como máximo dos páginas de 500 eventos por función habilitada.
- **Kubernetes**: KUA lee CPU y memoria desde `metrics.k8s.io` con un contexto kubeconfig aislado. Las métricas ya cargadas por otra vista de KUA pueden capturarse de forma oportunista sin otra solicitud.
- **Buckets**: las mediciones se reducen a buckets UTC de 30 minutos que contienen sólo valores `count`, `sum`, `min`, `max` y `last`.

KUA no persiste líneas de log raw, payloads de solicitud o respuesta, credenciales, secretos, variables de entorno ni tags arbitrarios de recursos en la base APM.

## Aplicaciones y Correlación

Las aplicaciones, la pertenencia de recursos y las dependencias son registros locales. Pertenencia y dependencia tienen significados distintos:

- Un tag o label puede identificar pertenencia a una aplicación.
- La similitud de nombre es sólo una sugerencia.
- El análisis de candidatos recibe el inventario ya cargado en la UI y realiza cero lecturas AWS o Kubernetes.
- Un recurso se asocia sólo después de confirmar su checkbox.
- Una dependencia se guarda sólo tras confirmación manual explícita. La pertenencia nunca crea una dependencia.

El análisis de candidatos es manual y nunca lo ejecuta el scheduler de 30 minutos.

## Recolección y Control de Coste

El polling está deshabilitado por defecto. Cuando se habilita, se ejecuta cada 30 minutos, sin ejecuciones solapadas ni solicitudes de recuperación. La recolección manual muestra una confirmación antes de leer datos cloud.

KUA reserva las solicitudes AWS iniciadas por APM contra un límite local de **100.000 solicitudes por perfil y mes UTC** antes de realizarlas. El límite es una protección, no una garantía de facturación: las lecturas de CloudWatch Logs pueden tener coste según los precios y el free tier de la cuenta AWS. Las lecturas Kubernetes y la captura oportunista no consumen el ledger AWS.

KUA nunca invoca una Lambda, modifica un workload, crea una métrica ni provisiona un recurso AWS durante la recolección APM.

## Umbrales

Cada aplicación tiene umbrales locales para tasa de error observada, duración Lambda promedio, porcentaje de pods listos y delta de reinicios. Las señales pueden deshabilitarse de forma independiente. La salud es `unknown` hasta que al menos un umbral habilitado tenga datos, `healthy` cuando todos los valores evaluados cumplen y `degraded` cuando algún valor vulnera su umbral.

La evaluación usa sólo agregados guardados y no inicia solicitudes cloud.

## Retención y Almacenamiento Local

Los buckets de métricas, cursores y ejecuciones de recolección se conservan durante **90 días**. El ledger de solicitudes AWS se conserva 15 meses para mantener auditables los límites mensuales UTC. La limpieza se ejecuta localmente una vez al día.

El archivo SQLite se llama `apm-observability.sqlite3`:

- Electron lo guarda en el directorio de datos de usuario de KUA provisto por el sistema operativo.
- El modo web/servidor usa `~/.kuadashboard/` por defecto.
- `KUA_DATA_DIR` permite cambiar el directorio.

El directorio se crea con modo `0700` y la base con modo `0600` en sistemas con permisos POSIX. SQLite usa modo WAL.

## Backup y Borrado

Cierra KUA antes de copiar o restaurar `apm-observability.sqlite3`. Esto permite que SQLite cierre el WAL correctamente; copiar sólo el archivo principal mientras KUA está en ejecución puede producir un backup incompleto.

Eliminar una aplicación borra sus recursos locales, dependencias, métricas, cursores y ejecuciones mediante las reglas cascade de SQLite. Para borrar todo el historial APM, cierra KUA y elimina `apm-observability.sqlite3` junto con los archivos `-wal` y `-shm` correspondientes. KUA crea una base vacía al iniciar de nuevo. Esto no elimina recursos cloud ni perfiles de credenciales.
