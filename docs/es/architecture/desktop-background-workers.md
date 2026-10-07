# Evaluación de aislamiento de tareas de escritorio

**Estado:** Mantener el modelo actual de Node.js. No agregar workers, procesos hijos ni Rust para las tareas programadas todavía.
**Fecha:** 2026-10-07

## Decisión

La página de escaneo perfilada tiene un tamaño acotado y hoy no justifica sacar trabajo del proceso backend. La recolección APM, el refresco de logs, la sincronización de aplicaciones/equipo y Advisor están dominados por esperas de red y base de datos. El escaneo tiene una transformación síncrona, pero el retraso del event loop medido queda bajo el umbral propuesto de respuesta del backend en esta máquina.

Este resultado es local a macOS, no un benchmark multiplataforma ni de Electron empaquetado. No se midió el tiempo de frame del renderer. Reabrir la decisión si producción reporta bloqueos de UI o si se incumplen los límites en Windows, macOS o Linux con datos representativos.

## Trabajos

| Tarea | Camino dominante | Clasificación |
| --- | --- | --- |
| Recolección APM | `ApmScheduler.runScheduled` espera los collectors por recurso; estos llaman APIs de proveedores y persisten resultados | I/O-bound |
| Refresco automático de logs | `createAutoRefresh.tick` lee páginas del proveedor y las ingresa a la caché local | I/O-bound con transformaciones locales acotadas |
| Escaneos de logs | `createScanRunner.runScan` espera páginas de FilterLogEvents y luego sanitiza, deduplica, analiza, sella y persiste cada página | I/O-bound; candidato medido |
| Sync de aplicaciones/equipo | `pass()` hashea bundles locales y contacta el servicio de cuenta solo cuando cambió el contenido | Mayormente I/O-bound; hash local según tamaño del bundle |
| Advisor programado | `tick()` llama rutas locales de KUA secuencialmente para los scopes vencidos | I/O-bound |

El análisis de embeddings locales es bajo demanda, no una de estas tareas programadas. Perfilarlo por separado antes de convertirlo en un trabajo de fondo.

## Perfil reproducible

Ejecutar desde la raíz del repositorio:

```sh
node scripts/profile-background-tasks.js
```

El script usa `createScanRunner` y `createLogCache` de producción, SQLite temporal en disco, un cliente sintético y no requiere credenciales ni red. Calienta con 100 eventos y luego ejecuta diez páginas de 5.000 eventos distintos (aproximadamente 1,01 MB de JSON por página). Mediciones tomadas con Node v23.4.0, macOS arm64, el 2026-10-07.

| Medición | Mediana | p95 |
| --- | ---: | ---: |
| Tiempo de pared por página | 41,58 ms | 45,96 ms |
| CPU del proceso por página | 50,21 ms | 81,51 ms |
| p99 de retraso del event loop, entre corridas | 27,77 ms | 29,21 ms |

El high-water mark de RSS del proceso subió de 54,48 MB antes de las diez páginas medidas a 120,95 MB después, unos 66,47 MB para toda la prueba de estrés. Es memoria global del proceso mientras permanecen 50.000 eventos distintos en diez grupos sintéticos; no es memoria atribuible a una tarea. La CPU del proceso puede superar el tiempo de pared porque la compresión Brotli asíncrona usa el pool de libuv. Un perfil V8 del hilo principal mostró expresiones regulares de sanitización y hashes de eventos entre el trabajo JavaScript muestreado; Brotli es asíncrono.

El event-loop delay es un indicador indirecto de respuesta del backend. No establece el impacto sobre frames del renderer, y las páginas sintéticas no incluyen latencia de red, diferencias de SQLite por plataforma ni empaquetado Electron.

## Umbrales para reabrir

Prototipar aislamiento solo si una carga realista y reproducible cruza alguno de estos límites en una plataforma soportada:

- Una página de 1 MB supera 100 ms p95 de pared, o 50 ms p95 / 100 ms máximos repetidos de event-loop delay.
- La CPU del proceso supera 100 ms por página en p95, o permanece por encima del 50 % de un core durante al menos un segundo en uso normal de fondo.
- El high-water mark de RSS del proceso crece más de 128 MB en diez páginas representativas tras el calentamiento. Sigue siendo un límite de proceso, no una atribución por tarea.
- Un trace de rendimiento del renderer muestra tareas largas repetidas de más de 50 ms correlacionadas con trabajo del backend.

## Trade-offs si se supera un umbral

El perfil actual no justificó un prototipo comparativo de worker y proceso. Si se supera un límite, medir la misma transformación pura y carga en el proceso actual, en un worker `worker_threads` reutilizable y en un proceso hijo; incluir arranque, ida y vuelta IPC de 1 MB, RSS máximo por proceso, event-loop delay, latencia de cancelación y builds empaquetados.

| Opción | Ventajas | Costos y cancelación |
| --- | --- | --- |
| `worker_threads` | Mantiene el mismo proceso de la aplicación; structured clone o buffers transferibles pueden mover transformaciones CPU puras | No aísla fallos del proceso ni RSS; los handles SQLite permanecen en el hilo propietario. Preferir cancelación cooperativa entre páginas/lotes. `Worker.terminate()` es un corte forzado y no garantiza limpieza arbitraria. |
| Proceso hijo | Límite separado de fallos y memoria; se puede reiniciar independientemente | Más costo de arranque/RSS e IPC serializado. Usar mensaje explícito de cierre, gracia acotada y luego terminación probada por plataforma; no prometer finalización ordenada tras matar a la fuerza. |
| Ejecutable/addon Rust | Solo podría ayudar si los perfiles muestran una transformación todavía intensiva en CPU tras mejoras de algoritmo y lotes | Agrega matrices de build nativo, firma y distribución para Windows/macOS/Linux. Hoy no hay evidencia que justifique ese costo. |

Cualquier prototipo debe cancelar cooperativamente entre lotes acotados, mantener las escrituras SQLite en su proceso propietario, limitar los bytes en cola y validar rutas ASAR/recursos más el empaquetado de Windows, macOS y Linux. No atribuir memoria exacta por tarea dentro de un proceso compartido.
