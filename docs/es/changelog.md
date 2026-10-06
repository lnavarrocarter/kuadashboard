# Changelog

## Unreleased

### Añadido
- **KUA Applications sin provider (modelo de datos):** una aplicación ya no necesita provider, perfil ni región propios, y su nombre ya no es único. Cada aplicación tiene scopes de provider portables (cuenta y región AWS, contexto de Kubernetes, proyecto GCP, team de Vercel) y, en cada computador, un binding local de un perfil a cada scope que nunca se exporta. Las aplicaciones existentes se migran al arrancar sin perder datos: reciben los scopes donde viven sus recursos y un binding al perfil que usaban, y el registry de recursos pasa a identidades sin perfil (un recurso visto con dos perfiles pasa a ser uno). `GET /api/kua-apps/migration-report` lista lo que necesita una decisión (scopes sin asociar o sin verificar, vistas de arquitectura rotas o compartidas, nombres repetidos). Crear estas aplicaciones y asociar perfiles desde la interfaz viene después.

### Arreglado
- **Perfil local en KUApps exportadas:** un KUAAppBundle (export, respaldo en la nube, sincronización y equipo) omitía los ids de perfil, pero los conservaba dentro de las identidades del registry de recursos (`identityKey`), y los cambios automáticos de arquitectura se exportaban con el perfil como autor. Ahora los recursos viajan con una identidad portable (provider, cuenta/proyecto/contexto, ubicación, tipo e id nativo), las relaciones apuntan a esos ids y los autores que eran perfiles se exportan como `local`; los bundles antiguos se limpian al leerse otra vez. Los respaldos y copias de equipo hechos antes de esta versión conservan el valor antiguo hasta que la aplicación se vuelva a subir. El contrato de KUA Application que lo sustenta, sin provider ni perfil propios, está en Arquitectura → Contrato de KUA Application.
- **Firmas de logs de contenedores:** las líneas envueltas por el runtime de contenedores (`{"time","stream","log"}` de Docker, containerd y Container Insights) y los logs con colores (NestJS, Winston) generaban una firma por pod y muestras llenas de códigos de escape. Las firmas y muestras ahora salen del mensaje de la aplicación sin colores, así que el mismo error en varios pods es un solo error recurrente. Los grupos en caché se vuelven a analizar automáticamente en la siguiente lectura (en local, sin llamadas a AWS).
- **API local accesible desde la red:** el servidor de KUA escuchaba en todas las interfaces de red, y su API no tiene autenticación, así que otro equipo de la misma red podía leer perfiles, clústeres y logs o abrir shells a través de él. Ahora escucha solo en `127.0.0.1`; `KUA_HOST` lo expone a propósito (por ejemplo `0.0.0.0` en una red de confianza), con un aviso al arrancar.
- **Idioma de las pantallas de detalle:** los detalles de EC2, Lambda, EKS y VPC, los paneles Info de Cloud Run, VM y Cloud SQL de GCP, el modal de creación de recursos de GCP, la terminal y las pantallas de conexión RDP/SSH de EC2, las vistas de AWS y GCP (cada pestaña de servicio, modal, aviso y lista vacía), el detalle de Step Functions, las vistas de Arquitectura (lienzo, rutas, recursos y paneles de discovery), Helm, el modal de perfiles, EventBridge, la observabilidad y los logs de aplicaciones, KUApps, los exploradores de S3 y GCS, el panel de observabilidad de EKS y el visor de archivos tenían texto fijo, así que varias quedaban en un solo idioma sin importar el de la app. Ahora siguen el idioma de la app, fechas incluidas, y un test evita que las pantallas migradas vuelvan a tener texto fijo.
- **Historial de versiones y textos restantes en los dos idiomas:** las versiones 1.16 y anteriores del modal de Ayuda, el sondeo, el historial de estados, las etiquetas y las confirmaciones de iniciar, detener y eliminar de GCP, el editor YAML, los avisos de actualización y de sesión de AWS, el port forwarding y la ventana de donación ahora están en inglés y español. Los scopes de GCP, el día de mantenimiento de Cloud SQL y los presets de creación llegan del servidor como códigos, así que también siguen el idioma de la app.
- **Búsqueda en CloudWatch Logs:** las búsquedas en vivo devolvían los eventos más antiguos del rango (FilterLogEvents lee hacia adelante) mientras que la caché devolvía los más nuevos, y la caché buscaba los filter patterns como texto plano. Ahora ambas devuelven los eventos más nuevos y aplican la misma sintaxis de filter patterns.
- **Despliegue del control plane:** El control plane en Cloud Run (`cloud/control-plane`) ya se construye y despliega. Cloud Build corre con la cuenta de despliegue en vez de la de Compute por defecto (sobre la que el deployer no podía actuar), sube el código a su propio bucket y ya no sube `node_modules`; el servicio corre como `kua-control-plane-run`. La configuración pasa a variables y secretos de GitHub, y los valores sensibles se sincronizan con Secret Manager. Los webhooks de Stripe fallaban con `PERMISSION_DENIED` porque la base `(default)` de Datastore del proyecto rechaza toda escritura; el servicio ahora usa su propia base `kua-control-plane`. `/health` reemplaza a `/healthz` (reservada por Cloud Run) y los errores 500 quedan registrados.

### Añadido
- **Registro del gasto opcional:** Ayuda y opciones → Cuenta desactiva el registro de lo que KUA gasta en APIs cloud (y, si quieres, borra su historial) y lo vuelve a activar. Mientras está desactivado no se registra nada y se ocultan los paneles de gasto del overview de AWS y de la caché de logs. Por defecto sigue activado.
- **Iniciar sesión en una cuenta KUA y contratar desde KUA:** Ayuda y Opciones → Cuenta inicia sesión con Google a través del navegador del sistema (redirección a la propia computadora con un código de un solo uso y PKCE; el token de sesión queda en el llavero del sistema operativo y nunca llega a la interfaz) y toma el plan de la cuenta, guardado 7 días para usarlo sin conexión y actualizado cada 6 horas. Con la cuenta vinculada se puede pasar a Pro o Team, mensual o anual, en el checkout de Polar (KUA espera la confirmación del pago y actualiza el plan) y gestionar la suscripción en el portal de facturación. `KUA_PLAN` sigue reemplazando el plan en una computadora, para desarrollo. El control plane suma `/auth/desktop/start`, `/auth/desktop/token`, cierre de sesión con token y una página para volver a KUA después del checkout.
- **Cuenta en Ayuda y Opciones, y el Advisor como función Pro:** una nueva pestaña Cuenta reúne todo lo que dependerá de la cuenta KUA: el plan y de dónde viene, una comparación Free / Pro / Team, el tamaño de la caché de logs, el ML local y lo que gastó KUA este mes; el inicio de sesión llega con la vinculación de cuentas. El Advisor ahora es parte del plan Pro: en Free, los overviews y KUApps muestran solo los conteos (chequeos que pasan, hallazgos por categoría y severidad) detrás de un candado con "Ver planes", y las herramientas MCP del Advisor explican el plan en vez de devolver hallazgos. Lo aplica el servidor, así que los recursos y las correcciones nunca llegan a un cliente Free. Mientras la app no se vincule a una cuenta, usa `KUA_PLAN=pro` o `team`.
- **Refresco automático de logs en caché y tamaño de caché configurable (planes Pro y Team):** cada log group de CloudWatch o workload de Kubernetes en caché puede refrescar sus eventos más nuevos cada 1, 5, 15, 30 o 60 minutos mientras KUA está abierto (sin rellenar historia, nunca con Logs Insights, se detiene al llegar al presupuesto de la caché), configurado desde su fila o apenas termina un escaneo, mostrando las solicitudes por día que genera y el próximo refresco. El tamaño de la caché de logs se elige en las vistas de logs (de 256 MB hasta 20 GB). Límites por plan: Free mantiene 256 MB y sincronización manual, Pro hasta 2 GB y refresco cada 15 minutos o más, Team hasta 20 GB y cada minuto o más. La app de escritorio suma una capa de planes con los mismos planes que el control plane; hasta vincularse a una cuenta KUA, el plan sale de `KUA_PLAN` (free por defecto). `KUA_LOG_CACHE_MB` sigue reemplazando el tamaño.
- **Logs de workloads de Kubernetes con inteligencia:** Logs → Logs de workloads lista los deployments, statefulsets, daemonsets y pods sueltos del namespace y les trae la experiencia de CloudWatch Logs: cachear los logs de los pods de un workload (cifrados, misma caché y presupuesto), consultarlos en vivo o desde la caché con sintaxis de Logs Insights, escanear hasta 5 días en segundo plano y abrir el mismo panel Intelligence con anomalías, ML local, recomendaciones y briefs para agentes. Los logs se leen por la API de Kubernetes (todos los contenedores, más la instancia anterior de los que se reiniciaron) detrás de un adaptador compatible con FilterLogEvents, así que la sincronización, el relleno de historia y los escaneos son los mismos que en CloudWatch; un único ejecutor de escaneos atiende a ambos proveedores. Los consejos exclusivos de CloudWatch (retención por CLI, políticas de protección de datos) se omiten en Kubernetes. Nuevas herramientas MCP: `list_kube_log_workloads`, `kube_log_intelligence` y `search_logs` con `provider: "kubernetes"`. Los errores de base de datos de TypeORM, MongoDB, Sequelize, Prisma y pg ("Unable to connect to the database", `ServerSelectionTimeout`, "Connection terminated unexpectedly"…) ahora se categorizan como errores de base de datos.
- **Lo que gasta KUA:** cada llamada al AWS SDK que hace KUA se mide en un solo lugar, se valoriza con los precios públicos de AWS (us-east-1) y, cuando tiene precio por uso, queda en un registro local con su cálculo: GetMetricData por métrica, Logs Insights por GB escaneado, Cost Explorer por solicitud, Athena por TB escaneado (mínimo 10 MB), Lex por solicitud de texto, y las descargas de logs (FilterLogEvents: sin cargo por solicitud, transferencia dentro de los primeros 100 GB al mes gratis, mostrada como el costo fuera de la capa gratuita). Cada llamada se atribuye al perfil y a la funcionalidad que la hizo, incluidos los escaneos en segundo plano y las recolecciones de Observabilidad. Un panel "Gasto de KUA" en el overview de AWS y en la vista de caché de logs muestra hoy, este mes y los últimos 7, 30 o 90 días, cada operación como cantidad × precio unitario = USD, el desglose por funcionalidad y las últimas llamadas facturables. Es una estimación de las llamadas de KUA, no la factura de AWS.
- **Secciones plegables en el panel Intelligence de logs:** anomalías, ML local, recomendaciones, categorías, errores y advertencias recurrentes, recursos mencionados y observabilidad se pliegan desde su título, mantienen un contador al lado (rojo o amarillo según severidad) y siguen cerradas entre log groups y sesiones. El panel ya no se recarga solo cuando una sincronización o un escaneo en segundo plano guarda eventos nuevos: avisa que hay un escaneo del grupo en curso y, cuando hay eventos nuevos en caché, ofrece "Actualizar análisis", así se conservan los filtros y las secciones abiertas mientras leés.
- **ML local para logs:** un modelo de embeddings local y opcional (paraphrase-multilingual-MiniLM-L12-v2, unos 130 MB, que se descarga una vez desde Hugging Face, gratis, al activarlo en Intelligence → ML local, y se puede borrar desde ahí) suma búsqueda por significado en los errores recurrentes de todos los log groups en caché, también en español sobre logs en inglés; agrupa errores que dicen lo mismo con otras palabras; y sugiere una categoría para los errores que las reglas dejan sin categoría. Corre en esta computadora con ONNX Runtime (ningún texto sale de ella, sin llamadas a AWS), sobre las firmas sanitizadas, y los vectores quedan en caché para calcular cada error una sola vez. Los agentes reciben los errores parecidos en el brief y una herramienta MCP nueva, `search_logs`. El instalador solo lleva los binarios de ONNX Runtime de su plataforma.
- **Anomalías en los logs:** el panel Intelligence de cada log group en caché señala qué cambió frente a sus 7 días anteriores: picos de errores en la última hora (y si solo acompañan a más tráfico), caídas del volumen de logs frente a la misma hora del día, una categoría de fallo o de cliente a 3× o más su ritmo habitual, y errores recurrentes que aparecieron en las últimas 24 h. Cada anomalía explica el valor esperado, abre su tramo de tiempo o sus eventos, y forma parte del brief para agentes y de la respuesta `log_intelligence` del MCP. Solo se evalúa el tiempo sincronizado, así que una caché desactualizada o nueva se informa en vez de adivinarse. Estadística simple sobre los agregados locales: sin IA y sin llamadas a AWS.
- **Briefs para agentes IA:** el Advisor de cada overview (AWS, GCP, Kubernetes y la lente de producto de KUApps) y las recomendaciones de la inteligencia de logs suman "Copiar para agente IA" y "Descargar brief (.md)". El brief es una tarea autocontenida en Markdown para Claude Code, Codex, ChatGPT o cualquier otro agente: contexto (proveedor, cuenta, región, namespace o log group), reglas de trabajo (verificar primero el estado actual, corregir por severidad y causa raíz, cambiar la infraestructura como código en vez de la consola, pedir confirmación antes de operaciones destructivas o con costo, nunca exponer secretos), cada hallazgo con sus recursos afectados y documentación, y para logs la actividad, las firmas sanitizadas, consultas de Logs Insights, ejemplos de código y los recursos con los que habla la carga, más cómo verificar la corrección. Se arma localmente con datos que KUA ya tiene, en el idioma de la app: sin IA y sin llamadas a la nube.
- **Servidor MCP para agentes IA:** `mcp/server.mjs` permite que Claude Code, Codex CLI y otros clientes MCP lean KUA directamente: perfiles, hallazgos del Advisor de AWS, GCP, Kubernetes y producto, log groups en caché y su inteligencia de logs, como los mismos briefs en Markdown o como JSON, en inglés o español. Corre por stdio en tu equipo, lee la API de KUA (KuaDashboard debe estar abierto; `KUA_URL` reemplaza `http://localhost:7190`), no tiene dependencias y todas las herramientas son de solo lectura: sin llamadas con costo y sin devolver credenciales. También corre desde la app instalada con el ejecutable de KuaDashboard en modo Node, así que no requiere Node.js; el ícono de enchufe junto a los botones del brief abre **Conectar agentes IA** con la configuración exacta para Claude Code, Codex CLI, clientes JSON y el `config.toml` de Codex. Configuración en Funcionalidades → Agentes IA.
- **Escaneos de logs en segundo plano:** leé hasta 5 días de un log group de CloudWatch en la caché local mientras seguís trabajando. Los escaneos corren en segundo plano (dos a la vez, el resto en cola), leen primero la hora más reciente, muestran progreso y tiempo restante, y se pueden pausar, reanudar o cancelar; el avance se guarda después de cada página, así que un escaneo interrumpido al cerrar KUA vuelve pausado y continúa donde quedó. El rango escaneado se mantiene más allá de la ventana habitual del grupo (hasta el límite de 7 días de la caché), y el escaneo se detiene en lugar de borrar datos cuando la caché llega a su presupuesto. Antes de empezar, KUA estima el volumen contra el espacio libre de la caché; FilterLogEvents no se cobra por request y la descarga cuenta como transferencia de salida de AWS (primeros 100 GB/mes gratis). "Ver en caché" abre el rango escaneado en los eventos cacheados.
- **Advisor en cada resumen:** los resúmenes de Kubernetes, AWS y GCP suman un panel de recomendaciones de buenas prácticas agrupadas en seguridad, infraestructura, arquitectura y desarrollo, cada una con su severidad, los recursos afectados y un link a la documentación del proveedor. Los chequeos son deterministas (sin IA) y solo usan datos que KUA ya lee o APIs de control gratuitas: Kubernetes suma NetworkPolicies, PodDisruptionBudgets y HPAs al resumen (contenedores privilegiados o como root, credenciales en texto plano en variables de entorno, faltan requests/limits/probes, una sola réplica, tags de imagen flotantes, namespaces sin NetworkPolicy…; se omiten los namespaces `kube-*`); AWS lee el credential report de IAM, CloudTrail, EC2, RDS, Lambda y EKS (MFA y keys de root, keys viejas o sin uso, puertos abiertos a internet, IMDSv1, bases públicas o sin cifrar, backups, Multi-AZ, runtimes deprecados, volúmenes e IPs huérfanos…; con caché de 15 minutos, sin llamadas a Cost Explorer ni CloudWatch); GCP reutiliza las filas del resumen (service accounts default, IPs públicas, backups y HA de Cloud SQL, acceso a buckets, hardening de GKE, runtimes deprecados…). Las fuentes que no se pueden leer se listan con las acciones IAM que necesitan.
- **Advisor de producto en KUApps:** cada aplicación tiene la mirada de producto: objetivos incumplidos, objetivos que quedaron en los defaults de KUA, sin equipo dueño o sin entorno, producción sin una etapa previa, sin arquitectura de los journeys de usuario y telemetría faltante o desactualizada. Se calcula desde el registro de KUApps sin llamadas a la nube.
- **AWS CloudFormation (solo lectura):** nueva pestaña Management → CloudFormation con todos los stacks agrupados por estado (completos, en curso, fallidos, revertidos, en revisión), estado de drift, protección contra borrado y stacks anidados. Cada stack muestra parámetros, outputs y tags, sus recursos vinculados a la pestaña de KUA que los gestiona, sus eventos con la causa raíz de la última falla resaltada, la plantilla original y la detección de drift bajo demanda con las diferencias de propiedades. Las lecturas de CloudFormation no tienen costo; los stacks se vinculan a KUA Applications (agregando sus recursos una sola vez), los exports muestran qué stacks los importan, los change sets se revisan con su riesgo (eliminaciones, reemplazos, recursos con datos), los parámetros se actualizan con un change set previsualizado, la protección contra borrado se activa o desactiva y los stacks se eliminan después de una previsualización del borrado. Las operaciones destructivas piden escribir el nombre del stack (y un motivo para borrar), el servidor las vuelve a verificar y quedan en el audit log, con un historial de operaciones por stack.
- **Cobertura del resumen:** CloudWatch Logs y CloudFormation ya no aparecen como cubiertos a medias; CloudWatch sigue parcial hasta que existan alarmas y un explorador de métricas.
- **Gráfico de actividad de logs:** eventos por nivel en el tiempo con una resolución que se adapta al rango (segundos, minutos, horas o días), zoom con clic o arrastrando, tooltip y vista de tabla; los resultados de Logs Insights agrupados con `bin()` también se grafican. El gráfico conserva su historia: un índice por minuto de eventos por nivel se guarda 30 días aunque los eventos ya hayan salido de la caché (un grupo con mucho volumen puede guardar solo una hora de eventos), y la vista "Volumen total" lee la métrica IncomingLogEvents de CloudWatch para cualquier grupo y rango (~USD 0,00001 por lectura, reutilizada desde el historial local de métricas).
- **AWS CloudWatch Logs:** nueva pestaña con todos los log groups clasificados como servicio de AWS, máquina (agente de CloudWatch, instancias EC2 detectadas por sus streams) o propios; streams y eventos recientes.
- **Caché local de logs:** guardá los log groups que elijas hasta 7 días, menos si el volumen del grupo no entra en su parte del presupuesto (`KUA_LOG_CACHE_MB`, 256 MB por defecto). Los eventos se sanitizan, se comprimen (~19x en logs reales de Lambda) y se cifran con AES-256-GCM usando una clave guardada en el llavero del usuario del sistema operativo; nunca salen de la máquina. Las sincronizaciones leen primero las horas más recientes y después completan las anteriores. Una caché anterior en texto plano se migra automáticamente. Cada grupo tiene una configuración de historial (solo eventos nuevos, última hora, 6 h, 24 h, 3 días o toda la ventana) y una acción "completar ahora".
- **Consultas de logs:** sintaxis de Logs Insights (`fields`, `filter`, `parse`, `stats`, `sort`, `limit`, `display`, `dedup`) con autocompletado, validación en vivo con sugerencias, plantillas por tipo de log y un armador de filtros. Corre gratis sobre la caché o una muestra en vivo, o en Logs Insights después de mostrar el volumen y el costo estimados.
- **Vista de respaldo en S3:** por log group, si sus logs se copian a S3 (suscripción o tareas de exportación) y cuáles vencen sin copia; tareas de exportación, CloudTrail y VPC flow logs escritos en S3, y un explorador del archivo que lee exportaciones gzip.
- **Inteligencia de logs:** cada log group cacheado se analiza con reglas deterministas compartidas con la evidencia de logs de Kubernetes: tasas de errores y warnings, firmas de error recurrentes, palabras clave de fallas (timeouts, throttling, memoria, accesos, conexión) y referencias a otros recursos. Solo se guardan agregados (30 días). En Observability, la topología inteligente muestra estas señales para los recursos de la aplicación, marca tasas de error por encima del umbral de la aplicación, lista los recursos sin logs cacheados y sugiere relaciones vistas en los logs para revisarlas; nada se conecta automáticamente. Las líneas REPORT de Lambda de los grupos cacheados también alimentan las métricas de APM. Los eventos se categorizan (timeouts, memoria, throttling, permisos, conexión, código, configuración, base de datos, errores del cliente, cold starts…) y se pueden filtrar por categoría, nivel o error recurrente; los valores sensibles que llegan a los logs se cuentan por tipo (incluidos números de tarjeta y RUT). Cada grupo recibe recomendaciones con evidencia y confianza: correcciones por categoría (con las acciones IAM exactas cuando un mensaje de acceso denegado las menciona), enmascarado en el origen y políticas de protección de datos de CloudWatch, logging estructurado, nivel de log y retención.
- **Cobro con Polar (merchant of record):** Stripe no acepta cuentas de Chile, así que el control plane pasa a tener un proveedor de cobro intercambiable, con Polar como principal: checkout y portal de cliente con la API REST de Polar, clientes vinculados por id externo, verificación Standard Webhooks y eventos de suscripción que activan o quitan Pro/Team. Mismos planes y precios; Stripe queda disponible para una futura empresa en el extranjero.
- **Planes de Stripe (modo prueba):** KUA Pro (USD 9/mes, 90/año) y KUA Team (USD 29/mes, 290/año, hasta 10 miembros), un portal de cliente para cambiar de plan, tarjeta o cancelar, y checkout anual. El plan sale del precio de la suscripción, así que los cambios de plan desde el portal se aplican.

## v1.17.0 (2026-09-28)

Cloud Insights suma resúmenes, costos, actividad y salud para AWS y Kubernetes, agrega SQS, SNS y SES, dibuja los dashboards de CloudWatch dentro de KUA y hace que cada lectura automática indique cuánto cuesta.

### Arreglado
- **Costos del auto-refresco de AWS:** El auto-refresco global (cada 5 s por defecto) volvía a leer la actividad de 24 h de Lambda y Step Functions y los KPIs del Resumen en cada ciclo. Esas lecturas usan `GetMetricData` de CloudWatch, que se cobra (USD 0.01 por cada 1.000 métricas, fuera de la capa gratuita): unos USD 0.006 por carga de la tabla de Lambda con ~600 métricas, o cerca de USD 4 por hora con la pestaña abierta. Ahora la actividad y los insights del Resumen se reutilizan durante 15 minutos y el resumen de recursos (gratis) durante 5; el botón de actualizar sigue forzando una lectura nueva.
- **Dashboards de AWS:** Los widgets de logs cuyo `SOURCE` es el ARN de un log group (por ejemplo `SOURCE "arn:aws:logs:…:log-group:/aws/lambda/…"`) fallaban con *Value at 'logGroupNamePrefix' failed to satisfy constraint*. La estimación de tamaño ahora usa el nombre del log group y la consulta usa `logGroupIdentifiers`, que acepta nombres y ARNs; los grupos cuyo tamaño no se puede conocer (por ejemplo, de otra cuenta) nunca corren solos. También se respetan los widgets con rango propio (`start`/`end`) y la leyenda oculta.
- **Vista Vercel:** Arreglado bug donde datos obsoletos de proyectos anteriores persistían tras cambios rápidos de proyecto. Se implementó protección contra condiciones de carrera con IDs de solicitud y limpieza explícita de contexto al cambiar de proyecto o perfil.
- **Modal AWS Lambda:** Arreglado que las celdas de la tabla de variables de entorno no envolvían valores largos (ARNs, strings largos). Se hizo responsive el layout de la pestaña Código en dispositivos móviles y tablets: el árbol de archivos y el visor de código ahora se apilan verticalmente en pantallas ≤768px.

### Cambiado
- **Idioma:** El inglés pasa a ser el idioma base. Las instalaciones nuevas arrancan en inglés (se respeta el idioma ya elegido) y un texto que falte en el idioma activo usa el inglés en vez de mostrar la clave. Las tablas de recursos de Kubernetes, los chips de filtros rápidos, el historial de filtros, el Resumen y el panel de detalle (pestañas Resumen, YAML, Env, Data, Métricas y Eventos) quedan traducidos completamente a inglés y español; un test mantiene ambos diccionarios con las mismas claves.
- **Navegación de Kubernetes:** Cambiar entre secciones del menú lateral (Workloads, Red, Configuración, Almacenamiento, Cluster) ya no vacía la tabla. Los recursos ya visitados en el mismo contexto y namespace aparecen al instante desde un caché local y se revalidan en segundo plano; solo un recurso nunca visitado muestra el estado de carga. Un delete, scale, restart o edición ahora invalida en el servidor solo las listas afectadas (por ejemplo, escalar un deployment refresca deployments, replicasets, pods y eventos) en vez de todo el caché, y los refrescos sin cambios no vuelven a renderizar la tabla.
- **AWS VPC:** La acción "Details" de VPC ahora se llama "Info" y abre un modal dedicado alineado al patrón Info de EC2/Lambda (tabs subrayados, listas de definición, botones de copiar, badges en el header). Mismos datos y endpoint que antes.
- **AWS Route 53 (correcciones):** Las pruebas DNS ahora llegan al backend (la UI llamaba a una URL inexistente), las pruebas A/AAAA incluyen la verificación TCP 443/80, las pruebas SPF y DKIM se ofrecen en los registros TXT que las contienen y solo se muestran pruebas que tienen sentido para cada tipo de registro. La selección de registros ya no se desplaza al cambiar la búsqueda o el filtro, los registros con política de routing (mismo nombre y tipo) se exportan por separado con su Set ID y las zonas con más de 300 registros se cargan completas. Se agregó una guía de diagnóstico DNS a la documentación de AWS.

### Añadido
- **Mensajería AWS: detalles, logs, salud e historial de métricas:** El detalle de SQS muestra consumidores Lambda, productores SNS, política de acceso, tags, espera de recepción (avisa el short polling) y más métricas. El de SNS muestra la filter policy, raw delivery y dead-letter queue de cada suscripción, y un visor de logs de estado de entrega (grupos de éxito y fallo, bajo demanda); la tabla suma tasa de éxito y mensajes filtrados. SES suma la lista de supresión, fallas de render, tasa de entrega, gráficos de tasas de reputación y métricas de eventos por configuration set (primero se cuentan, se leen a pedido). Colas, tópicos y la cuenta de SES tienen un estado de salud con motivos, con los umbrales de revisión de AWS SES. Las métricas por hora ya leídas se guardan en un historial local (base de APM), así los detalles solo piden lo que las tablas no leyeron y los gráficos de 24 h / 7 d / 30 d lo reutilizan; la retención se configura en Opciones (30 días por defecto). Los recursos usan las identidades del registro de KUA, y `GET /api/cloud/aws/metrics/history` lee el historial guardado sin llamar a AWS, listo para KUA Applications.
- **SQS, SNS y SES en AWS (#85, #86, #87):** Nuevas pestañas en Integration. SQS: colas con mensajes visibles y en vuelo, enviados/recibidos/borrados en 24 h, dead-letter queue y redrive, cifrado y retención. SNS: tópicos con suscripciones confirmadas y pendientes, protocolos, publicados/entregados/fallidos en 24 h y estado del delivery status logging. SES: estado de envío, sandbox, cuota de 24 h, tasa de envío, métricas de enviados/entregados/rebotes/quejas/rechazados, identidades con verificación, DKIM y MAIL FROM (SPF), y configuration sets con sus destinos de eventos. Cada recurso tiene un detalle con gráficos por hora de 24 h de CloudWatch, avisos cuando faltan métricas o logs (con *Solicitar acceso*), y cada pestaña indica su costo; listar SQS se cobra por solicitud, así que una nueva opción *Auto-actualización de tablas* para AWS (30 s por defecto) limita las recargas en segundo plano. Los tres servicios se cuentan en el Resumen en vez de *fuera de KUA*, y los costos guardados en caché antes de que un servicio tuviera pestaña ya no lo marcan como fuera de KUA.
- **Caché y actualización para Kubernetes, GCP y Vercel:** Opciones ahora agrupa la caché y la actualización por proveedor. Kubernetes: ventana de la caché de listas de recursos (se aplica a la caché del backend con `PUT /api/system/cache-settings`), intervalo de auto-actualización del Resumen y tendencias de Prometheus y reutilización del descubrimiento de Prometheus. Google Cloud y Vercel: tiempo mínimo entre recargas de tablas en segundo plano. Ninguna de estas lecturas se cobra por llamada; los nuevos valores de 30 s para el Resumen de Kubernetes y las tablas de GCP y Vercel reemplazan la recarga en cada ciclo de 5 s, y los botones de actualizar siguen cargando al instante.
- **Opciones de plataforma: caché y almacenamiento:** Ayuda → Opciones tiene un grupo *Caché y actualización* para elegir cuánto tiempo se reutilizan la actividad de AWS, los KPIs del Resumen, el conteo de recursos y los costos de Cost Explorer, el intervalo de auto-actualización de los dashboards de CloudWatch y el límite de ejecución automática de Logs Insights. Cada opción muestra su costo con el valor elegido. Un panel *Almacenamiento local* muestra el espacio que usa la carpeta de datos de KUA: cada base SQLite con espacio usado, páginas libres, journal WAL y filas y tamaño por tabla, cada archivo, el almacenamiento del navegador, los perfiles con costos de AWS en caché y el espacio libre en disco (`GET /api/system/storage`, solo lectura). La pestaña Opciones ahora se adapta al ancho de un teléfono, *Restaurar valores por defecto* conserva el idioma y los botones de idioma vuelven a mostrar sus banderas.
- **Conexiones guardadas en la Consola:** Guarda cualquier sesión de la consola con un nombre reconocible y vuelve a abrirla con un clic desde el workspace de Consola (logs/exec de Kubernetes, shell local, SSH a EC2, AWS SSM con su confirmación, logs/SSH de GCP, logs de Vercel); renombra o borra las conexiones guardadas y renombra las sesiones activas (doble clic en el nombre de la pestaña). Solo se guarda lo necesario para reabrir, nunca credenciales. Las sesiones y pestañas muestran iconos y colores por proveedor, y los nombres largos se acortan por el medio.
- **Actividad y estado de logs en AWS:** La tabla de Lambda muestra las invocaciones y errores de las últimas 24 h de cada función y el estado de su log group de CloudWatch Logs (activo, vacío, inexistente o desconocido, usando los grupos propios de `LoggingConfig`), y la tabla de Step Functions muestra las ejecuciones de 24 h (incluidas las Express) y el nivel de logging, marcando las máquinas con el logging apagado. El endpoint de logs de Lambda responde un log group inexistente con un estado tipado en vez de un error, y la pestaña de logs de Lambda ahora está traducida. SQS, SNS y SES quedan en sus propios issues.
- **Dashboards de AWS dibujados en KUA:** Los dashboards de CloudWatch ahora se pueden ver dentro de KUA con su disposición original: widgets de métricas (series de tiempo, barras, valor único, expresiones, SEARCH, SQL de Metrics Insights, anotaciones y umbrales de alarma), widgets de Logs Insights como tablas o barras, y widgets de texto y alarmas, con selector de rango y auto-actualización solo de métricas. Las consultas de logs muestran primero una estimación de los datos a leer y solo corren solas bajo ~1 GB; cada widget muestra los bytes leídos. El catálogo IAM ahora lee los comandos del SDK que importa cada ruta, lo que también completa las rutas de etiquetas.
- **Dashboards de CloudWatch en AWS:** Nueva vista *Monitoreo → CloudWatch Dashboards* que lista los dashboards de la cuenta con un enlace para abrir cada uno en la consola de AWS y un panel de detalle que resume sus widgets (métricas y namespaces, log groups de Logs Insights, alarmas, vista y región) y muestra la definición JSON. Las fechas de las tablas de AWS ahora siguen el idioma de la app en vez del sistema operativo.
- **Costos y cobertura en el Resumen de AWS:** El Resumen de AWS ahora muestra el costo del mes, la proyección a fin de mes, el mes anterior y los servicios más caros desde Cost Explorer (en caché 12 h por perfil en disco, porque AWS cobra cada consulta, con actualización manual), con la métrica de facturación de CloudWatch como respaldo; tarjetas de actividad de las últimas 24 h para Lambda, EC2 (CPU), load balancers (requests, 5xx, latencia), EKS (con Container Insights), RDS, DynamoDB, Step Functions, EventBridge, ejecuciones de Glue, CloudFront y almacenamiento de S3; y los servicios fuera de KUA que tienen costo, recursos etiquetados o cambios recientes en CloudTrail. Cada fuente se degrada por separado y ofrece solicitar acceso si falta un permiso.
- **Solicitudes de acceso en AWS:** Los errores de permisos de AWS ahora son tipados: la API responde 403 con la acción IAM rechazada, las demás acciones que necesita la pantalla y una policy IAM sugerida. El aviso de error de AWS y las tarjetas *Sin permiso* del Resumen ofrecen **Solicitar acceso**, con un mensaje copiable para el administrador de AWS (en inglés o español) y el JSON de la policy. Las acciones salen de un catálogo generado desde los comandos del SDK de cada ruta (`npm run aws:iam-catalog`), limitado a los servicios que soporta KUA.
- **Resumen de AWS:** Nueva primera vista del módulo AWS con la cuenta activa (y su alias), el tipo de identidad y su ARN (con advertencia si son credenciales root), la región del perfil y las regiones habilitadas de la cuenta, y una tarjeta por servicio con su cantidad de recursos para 16 servicios. Los servicios se leen en paralelo, cada uno con su tiempo máximo, así que un permiso faltante solo marca su tarjeta (mostrando la acción IAM cuando AWS la informa). Al hacer clic en una tarjeta se abre la pestaña del servicio. Lambda usa el total de la cuenta en vez de paginar todas las funciones.
- **Resumen de Kubernetes:** Nuevo Resumen arriba en el menú lateral de Kubernetes con pods por estado, pods con problemas (CrashLoopBackOff, ImagePullBackOff, OOMKilled, NotReady…), salud y presión de nodos, workloads por debajo de sus réplicas deseadas, eventos Warning recientes y uso de CPU/memoria del clúster desde metrics-server. Pods, workloads y eventos siguen el selector de namespace; nodos y uso cubren el clúster. Cada tarjeta y fila abre la tabla correspondiente ya filtrada, y cada sección se degrada por separado si falta un permiso o la Metrics API. La columna Status de Pods ahora muestra el motivo del problema y un nuevo filtro rápido *Con problemas* lista los pods no sanos. El descubrimiento de Prometheus ahora se cachea por contexto en vez de listar todos los Services en cada consulta.
- **Tendencias en el Resumen de Kubernetes:** Con Prometheus en el clúster, el Resumen agrega gráficas de CPU, memoria, reinicios y pods no listos para 1 h, 6 h, 24 h o 7 d, del clúster completo o del namespace seleccionado. Los clústeres sin metrics-server ahora obtienen el uso actual del clúster y por nodo desde Prometheus node-exporter. Las consultas a Prometheus reutilizan el servicio y puerto que respondió la última vez en vez de reintentar todos los candidatos.
- **Vistas de tablas de Kubernetes:** Cada tabla de recursos recuerda su filtro de texto, columna de orden y chips de filtro al salir y volver, y también tras recargar. Nuevos chips de filtro rápido con conteos en la mayoría de los recursos (por ejemplo, Pods: No Running, No listos, Con reinicios; Deployments: No listos, En 0 réplicas; ReplicaSets: Inactivas; Services/Endpoints: Sin backends; Secrets: TLS, Registry, Opaque; HPAs: En el máximo/mínimo; PDBs: Bloquean desalojos; NetworkPolicies: Bloquea ingress/egress; Nodes: No Ready, Cordoned; PVCs/PVs: No Bound). La caja de filtro guarda un historial de filtros recientes por recurso y permite marcarlos con estrella para dejarlos guardados.
- **AWS Route 53:** Se agregó funcionalidad de búsqueda y filtrado para registros DNS. Los usuarios ahora pueden buscar registros por nombre o valor, filtrar por tipo de registro (A, TXT, MX, CNAME, etc.), seleccionar múltiples registros con checkboxes, y exportar los registros seleccionados como CSV para respaldo o análisis.
- **AWS Route 53 Validación DNS:** Se agregó validación y diagnóstico de registros DNS. Los usuarios pueden probar registros directamente desde la vista de Route 53 para verificar que se resuelven correctamente y están publicados en Internet. Soporta registros A (con verificación de conectividad TCP), TXT, MX, CNAME, NS además de validación de SPF y DKIM. El backend usa el módulo dns nativo de Node para resolución DNS pública.
- **Services de Kubernetes:** La tabla de Services ahora muestra la app asociada (desde el selector del Service) y las IPs internas de los pods que respaldan cada Service, leídas de EndpointSlices con una sola llamada por namespace. Se marcan los pods no listos, y las columnas Type y Cluster IP no cambian.
- **Info de AWS EKS:** Nuevo panel Info para clusters EKS, con el diseño de EC2/Lambda, enfocado en la infraestructura AWS del cluster: VPC, subnets y security groups (con qué usa cada uno), managed node groups, instancias EC2 nodo (managed, Karpenter y self-managed) y add-ons de EKS. Cada sección se degrada por separado con un aviso cuando falta un permiso. La tabla de EKS agrega las columnas Node groups y cantidad de instancias EC2, y muestra el endpoint de la API bajo el nombre de cada cluster.
- **Severidad de eventos de Kubernetes:** Los eventos se colorean como Critical, Warning o Normal (columna con badge y borde de fila) según su tipo y motivo, y chips con conteos en la barra filtran la tabla por severidad, combinados con el filtro de texto.
- **Selector Perfil → Proyecto de Vercel:** Un selector de Proyecto junto al perfil de Vercel en el header, como Cluster → Namespace en Kubernetes. Cambiar de perfil recarga sus proyectos; cambiar de proyecto recarga la vista activa que depende del proyecto. Se recuerda el último proyecto por perfil y la tabla Projects queda sincronizada como atajo. Elegir un proyecto ya no recarga las vistas que no dependen de él, y las listas de proyectos de un perfil anterior se ignoran si llegan tarde.
- **GCP Cloud Run, VMs de Compute y Cloud SQL:** Tablas con columnas de detalle (imagen, CPU/memoria, escalado y revisión en Cloud Run; red, discos, Spot y protección en VMs; estado claro RUNNING/STOPPED, HA, almacenamiento, backups e IPs en Cloud SQL) y Start/Stop/Eliminar en cada fila. Nuevos formularios de creación con costo estimado en vivo. Iniciar muestra el costo estimado y exige aceptar el costo; eliminar exige escribir el nombre y se bloquea si el recurso tiene protección contra eliminación; crear exige el nombre, aceptar el costo y, desde $100/mes, una segunda confirmación de costo alto. El backend aplica las mismas validaciones y audita cada creación y eliminación.
- **SSH a VMs de GCP:** Abre una shell SSH en una VM de Compute Engine desde la tabla de VMs, dentro de la consola de KUA, igual que el SSH de EC2 y sin llaves guardadas: una llave cifrada por cuenta de Google, autorizada vía OS Login o metadata con vencimiento de 24 horas y reutilizada al reconectar sin modificar la VM.
- **Detalle, etiquetas e historial de estados en GCP:** El detalle de Cloud Run, VMs y Cloud SQL se reorganiza en tarjetas con mucha más configuración y observaciones de seguridad (acceso público, secretos en texto plano, backups desactivados, conexiones SQL sin cifrar…), sin exponer nunca valores secretos. Las etiquetas se pueden editar con las reglas de GCP validadas. Una nueva pestaña Historial muestra los cambios de estado y las acciones; el sondeo de estados en segundo plano se puede activar por perfil con intervalo, tipos de recurso y retención a elección (desactivado por defecto, con las lecturas de API por día visibles).

## v1.16.0 (2026-09-16)

Console Sessions unifica toda conexión remota — Kubernetes, Terminal local, SSH de EC2, AWS SSM, GCP y Vercel — detrás de un único registro compartido de sesiones y un workspace global.

- Las sesiones de Consola ahora tienen acciones contextuales "Open in Console" de un
  clic donde realmente existe la capacidad: una fila de instancia EC2 obtiene una nueva
  acción "⚡ SSM" junto a SSH/RDP, la pestaña Logs de un servicio de GCP Cloud Run
  obtiene una acción "Open in Console", y una fila de deployment de Vercel obtiene otra.
  Toda sesión abierta desde Architecture, Observability o estas nuevas acciones ahora
  encadena correctamente su environment y application id reales hacia la sesión (antes,
  toda entrada de auditoría de una sesión mostraba `environment: default` sin importar
  desde dónde se abriera). El lanzador de Console de GCP Cloud Run ya no requiere
  escribir un project id — siempre se resolvía desde el perfil de credenciales del lado
  del servidor, pero una validación más estricta del lado del cliente bloqueaba que ese
  fallback se usara. Esto cierra el épico de Consola (#36-43). Ver
  [sesiones de consola](../architecture/console-sessions.md).
- GCP y Vercel se suman a la Consola con capacidades honestas: ahora se pueden seguir
  logs de Cloud Run (GCP) y de deployments (Vercel) como sesiones (sin shell — ambas son
  streams de logs de una sola vía), mientras que Cloud Shell de GCP queda marcado
  explícitamente como no disponible, con el motivo visible en el lanzador, ya que no hay
  forma de iniciarlo desde una credencial de service account almacenada.
  Ver [sesiones de consola](../architecture/console-sessions.md).
- Ahora se pueden iniciar sesiones AWS SSM Session Manager desde la Consola — sin
  necesidad de claves SSH, solo un perfil de AWS confirmado y un ID de instancia.
  Requiere tener instalado `session-manager-plugin` de AWS (el lanzador muestra una
  ayuda de instalación y deshabilita Conectar si no está); iniciar una sesión siempre
  requiere confirmación explícita primero. Un permiso denegado nunca deja una sesión
  huérfana. Ver [sesiones de consola](../architecture/console-sessions.md).
- Las pestañas de Consola, su orden, la pestaña activa y las preferencias de ajuste
  de línea/altura ahora sobreviven a una recarga — las pestañas restauradas siempre
  vuelven desconectadas, nunca reanudando una sesión remota en silencio, y requieren
  un Reconectar explícito (ahora disponible también desde el panel rápido, no solo
  desde el workspace de Consola). El historial de comandos ahora es compartido y se
  persiste por destino exacto (namespace/pod/container, ambiente, o host/usuario/
  perfil) en lugar de dos historiales separados, no persistidos y sin alcance,
  acotado a 200 comandos por destino y 50 destinos en total, con una acción
  explícita de "Borrar historial" por pestaña y "Borrar todo el historial" en el
  workspace de Consola. Nunca se escribe nada sensible en el almacenamiento — solo
  el descriptor de sesión, nunca output crudo ni credenciales.
  Ver [sesiones de consola](../architecture/console-sessions.md).
- Las sesiones SSH de EC2 ahora se unen al mismo registro compartido de Consola
  que Terminal local y logs/exec de Kubernetes: conectarse al mismo host/usuario/
  perfil de credenciales desde la vista de AWS y desde el lanzador del workspace
  de Consola converge en una sola sesión en lugar de abrir una segunda conexión
  en paralelo, y el estado de la sesión ahora es uno de `connected`, `error`,
  `done`, `reconnecting` o `stopped` en lugar de un genérico "closed" único. RDP
  de EC2 no cambia. Se eliminó la vista de Terminal local independiente, que ya
  no se usaba. Ver [sesiones de consola](../architecture/console-sessions.md).
- La Consola ahora es accesible desde un botón global en el header, disponible
  en cualquier módulo, además del panel rápido existente. Abre un workspace
  dedicado que lista todas las sesiones activas (proveedor, ambiente,
  región/proyecto, destino, estado) con acciones de cerrar/reconectar, más un
  lanzador para iniciar nuevas sesiones de Terminal local o logs/exec de
  Kubernetes. Ambas superficies leen el mismo store de sesiones, así que nada
  abierto en una queda invisible en la otra. SSH/RDP de EC2 siguen siendo
  accesibles solo desde la vista de AWS por ahora.
  Ver [sesiones de consola](../architecture/console-sessions.md).
- El Canvas de Architecture agrega un overlay opt-in de "Events" que muestra los
  Kubernetes Warning Events sobre el nodo correspondiente (ahora se captura
  `kind`/`name`/`namespace` de cada evento), y acciones de nodo inline
  "Ver métricas aquí" / "Ver logs aquí" que abren en un modal en lugar de
  navegar siempre fuera del Canvas.
- Las conexiones de consola validan su contexto antes de abrirse. SSH/RDP de EC2
  usan el ID de un perfil de credenciales de Env Manager, en lugar de introducir
  contraseñas o rutas de claves en la consola. Local y Kubernetes siguen disponibles;
  SSM, shell GCP y logs Vercel quedan explícitamente planificados, no habilitados.
  Ver [sesiones de consola](../architecture/console-sessions.md).

## v1.15.0 (2026-09-05)

Architecture Foundation integra arquitectura y observabilidad centradas en aplicaciones dentro de KUApps.

Continúa el plan de convergencia de KUA Application (Fases 9-16): contexto Architecture persistente, navegación a nivel de recurso, overlays de salud en el Canvas, una vista canónica de Resources compartida, menos revisiones sorpresa del grafo, diagnóstico de sincronización visible, filtros compartidos entre Canvas y Routes, y sugerencias deterministas de relaciones basadas en logs. También corrige un bug real de duplicación encontrado al validar este trabajo.

### Observability: inteligencia de logs Kubernetes en Intelligent

- El panel de topología Intelligent ahora mide las líneas retenidas actualmente por las pestañas de logs Kubernetes abiertas explícitamente para workloads/Pods: cantidad de líneas, tasa de error, advertencias, firmas de error recurrentes normalizadas y conteos de palabras habituales de fallo.
- La medición es determinista y está acotada a la sesión. No ejecuta otra lectura a Kubernetes, no persiste logs crudos ni participa en el scheduler de 30 minutos. Las tasas históricas y alertas quedan para una futura fase de agregación persistida.
- La evidencia de relaciones derivada de logs redacta credenciales comunes, tokens bearer, credenciales en URLs, query strings de URLs y valores con forma de correo antes de mostrar una muestra corta. El flujo explícito de revisión sigue siendo obligatorio antes de confirmar una dependencia `calls`.

### Architecture Canvas y Routes: filtros de relaciones y carriles por proveedor

- Canvas y Routes ahora comparten filtros persistidos por tipo y estado de relación, para enfocar diagramas grandes en `routes_to`, `uses`, relaciones sugeridas/manuales u otros cortes de dependencias sin cambiar el grafo.
- Canvas agrega una organización por carriles de proveedor que agrupa recursos por nube/plataforma y los ordena por etapa lógica: entradas, routing/buffers, compute, runtime, datos/configuración y gobierno.
- Canvas también agrega una organización por proveedor + secciones de recurso para diagramas que deben mantener cada proveedor separado primero y luego dividir sus recursos por tipo dentro de ese proveedor.
- Los carriles por proveedor usan conectores escalonados y encabezados de sección para que los diagramas multiproveedor queden más estructurados y fáciles de recorrer.
- Los layouts por secciones ahora amplían el espacio entre nodos cuando hay overlays activos como labels, métricas, estado de collection o trazas, y ordenan recursos del mismo tipo usando primero el contexto de relaciones antes que el nombre.
- Se mejoró el toolbar del Canvas en pantallas estrechas para que los filtros y botones de overlays sigan disponibles dentro de una franja desplazable horizontal.
- Refrescar un proyecto Architecture ahora recarga el grafo en la vista actual en vez de limpiar y remontar Canvas/Routes/Resources mientras la petición está en curso.
- Cuando Architecture se abre dentro de KUApps, los proyectos ahora aparecen como subnivel de la Application seleccionada en vez de consumir una segunda barra lateral junto al canvas.
- KUApps ahora usa su barra lateral global como único cambio entre Architecture y Observability, y Observability ya no renderiza una segunda lista interna de aplicaciones cuando está embebido allí.

### Architecture Canvas: exportación a PDF y Mermaid

- Se agregó un botón "Export PDF" que renderiza el diagrama completo (todos los nodos y relaciones, no solo lo visible en pantalla) en un PDF listo para imprimir, dimensionado al tamaño total del grafo, para que diagramas grandes puedan imprimirse o compartirse sin que nada quede recortado.
- Se agregó un botón "Export Mermaid" que descarga el diagrama actualmente visible (respetando los filtros activos de proveedor/contexto/namespace) como un archivo `.mmd` de Mermaid.
- Se corrigió que "Export PDF" generaba una página en blanco: el zoom del diagrama se calculaba con la unidad de margen incorrecta, lo que encogía todo el diagrama hasta casi desaparecer dentro de la imagen exportada. También se agregó un límite de tamaño y un timeout con aviso de error para que exportar un diagrama muy grande falle de forma controlada en vez de quedarse colgado indefinidamente.

### Architecture: descubrimiento de referencias por variables de entorno de Lambda

- El escaneo de inventario regional de AWS ahora infiere con qué habla una función Lambda (colas SQS, tablas DynamoDB, buckets S3, tópicos SNS) leyendo su configuración de variables de entorno — la misma metadata que `ListFunctions` ya devuelve — sin descargar ni ejecutar el código de la función.
- Solo los valores que resuelven a un ARN completo o a una URL de cola SQS se convierten en sugerencia de recurso/relación; strings arbitrarios y secretos nunca se copian al grafo ni a su evidencia.
- Estas nuevas relaciones `references` fluyen por la misma revisión de sugerencias y detección de aplicaciones candidatas ya existente, así que una Lambda de arquitectura basada en eventos (por ejemplo un dispatcher de colas) ahora puede mostrar su cola/tabla/bucket relacionado como sugerencia de importación incluso cuando nada apunta a ella desde CloudFormation o EventBridge.

### Architecture: descubrimiento de capacidades por rol IAM y referencias estáticas de código

- El escaneo de inventario regional ahora también lee las políticas del rol de ejecución de cada Lambda (solo metadata) y muestra colas, tablas, buckets o tópicos que está *autorizada* a usar como sugerencia más débil de "puede acceder", incluso cuando nada en su configuración las referencia todavía.
- Un nuevo lector de código estático, estrictamente opt-in, puede descargar el paquete de despliegue de una Lambda específica y buscar patrones de ARNs/URLs literales y uso de clientes SDK de AWS en su texto fuente — nunca ejecuta ni evalúa el código, y solo corre para funciones seleccionadas explícitamente para el análisis.
- Ambas señales reutilizan el mismo flujo de revisión de sugerencias de relación que cualquier otra fuente de discovery.

### Architecture: discovery de recursos generalizado (fan-out SNS, servicios desconocidos, cross-stack)

- Cualquier ARN de AWS reconocible ahora se convierte en un recurso sugerido, incluso para servicios sin soporte dedicado todavía (Kinesis, destinos de API, etc.) — antes se descartaban en silencio, lo que también hacía que algunos targets de EventBridge nunca aparecieran.
- Los tópicos SNS y sus suscripciones SQS/Lambda ahora se descubren como parte del escaneo regular de AWS, completando patrones comunes de fan-out pub/sub.
- Cuando un recurso CloudFormation importa un valor de otro stack (`Fn::ImportValue`) que no se puede resolver solo con los stacks seleccionados, el panel de discovery ahora muestra un aviso recomendando agregar también ese stack, en vez de descartar esa dependencia en silencio.

### Corregido: "Retry sync" nunca lograba limpiar algunos recursos divergentes

- Los tipos de recurso que Architecture puede descubrir pero que Observability todavía no soporta en su esquema (S3, SNS, DynamoDB y cualquier servicio AWS detectado genéricamente) se contaban como "divergentes" aunque nunca pueden observarse desde ambos lados — reintentar la sincronización nunca los podía corregir, ya que eso requeriría correlacionar con una fuente que no existe para esos tipos.
- El diagnóstico de recursos divergentes ahora solo cuenta tipos de recurso que realmente pueden confirmarse desde Observability y Architecture a la vez. Las relaciones divergentes (pendientes de revisión) no cambian, ya que esas sí son accionables desde el Canvas.

### Architecture + Observability: S3, SNS y DynamoDB ahora correlacionan como recursos compartidos

- El registro compartido de recursos de Observability ahora soporta buckets S3, tópicos SNS y tablas DynamoDB, igualando lo que el discovery de Architecture ya podía encontrar. Estos recursos ahora correlacionan automáticamente en una sola entrada compartida en vez de aparecer solo del lado de Architecture.
- Se corrigió un bug de identidad relacionado: los nombres de bucket S3 son únicos globalmente y nunca llevan cuenta/región en su ARN, así que depender de la cuenta/región del momento de discovery del nodo de Architecture para calcular la identidad podía crear una entrada de registro duplicada en vez de coincidir con la que produce Observability.

### Corregido: los workloads Kubernetes podían descubrirse dos veces con una identidad rota

- El discovery de Kubernetes derivaba el Kind de un workload (Deployment, StatefulSet, ...) de un campo que la API de Kubernetes no siempre devuelve en resultados de listado, lo que podía convertirse en silencio en un valor vacío o genérico. Cuando eso pasaba, la identidad del workload descubierto ya no coincidía con la de un alta manual o una sincronización previa, creando un recurso duplicado en Observability y un nodo duplicado en Architecture.
- El Kind del workload ahora se conoce de antemano según qué endpoint de Kubernetes lo produjo, nunca se infiere de ese campo poco confiable, así que los workloads recién descubiertos siempre resuelven a la misma identidad que su contraparte agregada manualmente o sincronizada antes.

### Architecture: los paneles de discovery muestran los recursos ya agregados al proyecto

- Tanto el panel de discovery de AWS como el de Kubernetes ahora marcan los recursos del preview que ya existen en el grafo del proyecto actual, en vez de listarlos igual que los nuevos. Los recursos ya agregados muestran una insignia distintiva y ya no se pueden volver a seleccionar por accidente.
- Las aplicaciones identificadas también muestran cuántos de sus recursos ya forman parte del proyecto.

### Observability: los recursos Kubernetes muestran su tipo específico, y la divergencia se marca por elemento

- Los recursos Kubernetes en la tabla de Resources y la vista de Topology de Observability antes se mostraban todos como "Kubernetes" genérico con el mismo ícono. Ahora muestran su tipo real (Deployment, Pod, Service, ConfigMap...) con un ícono acorde, para distinguirlos de un vistazo.
- Los recursos divergentes y las relaciones divergentes (pendientes de revisión) ahora se marcan individualmente, no solo como conteo agregado, usando la misma regla que ya excluye tipos de recurso que Observability nunca puede correlacionar — lista para extenderse a futuros tipos de recurso de GCP/Vercel sin cambios de UI.

### Architecture: los Deployments de Kubernetes ahora se relacionan entre sí desde metadata, igual que ya pasa con AWS

- El discovery de Kubernetes solo relacionaba recursos por selectores de labels y referencias a ConfigMap/Secret/PVC; un Deployment cuyas variables de entorno apuntaban a otro Service por nombre (la forma más común en que las apps Kubernetes realmente se llaman entre sí) no generaba ninguna relación.
- El discovery ahora lee los valores planos de variables de entorno — sin descargar ni ejecutar nada — y reconoce tanto una referencia DNS interna completa (`service.namespace.svc.cluster.local`) como un nombre de servicio simple cuando la propia clave de la variable lo sugiere (`..._HOST`, `..._URL`, `..._SERVICE`, ...), sugiriendo una relación `calls` hacia el Service o Deployment coincidente.
- Estas sugerencias pasan por el mismo flujo de revisión que cualquier otra relación descubierta, y ahora aparecen de forma consistente tanto en Architecture como en Observability.

### Observability: EC2 y S3 reportan métricas de CloudWatch, y más recursos AWS llegan al inventario

- Los recursos EC2, EKS, RDS, API Gateway, CloudFront, Auto Scaling y ElastiCache descubiertos por Architecture eran rechazados de plano por la restricción de tipo de recurso, así que nunca aparecían en Observability ni siquiera como inventario. Ahora se almacenan y correlacionan como cualquier otro recurso.
- Las instancias EC2 ahora reportan CPU, red entrante y saliente, y chequeos de estado fallidos. Los buckets S3 reportan almacenamiento usado y cantidad de objetos, pedidos al ritmo diario al que esas métricas realmente se publican.
- Estas lecturas vienen de CloudWatch, que cobra por solicitud, así que cada recurso es una sola llamada que lleva todas sus métricas, el presupuesto mensual de solicitudes AWS se reserva antes de gastarlo, y una llamada fallida igual reporta lo que gastó. La confirmación de recolección indica explícitamente que estas lecturas son facturables.
- Los recursos de un tipo sin objetivo medible — un security group también es un recurso "EC2" — se reportan como inventario sin contactar nunca a CloudWatch.

### Corregido: importar recursos descubiertos descartaba silenciosamente sus relaciones

- Desde que los recursos ya presentes en un proyecto dejaron de ser seleccionables, cualquier relación que conectara un recurso recién seleccionado con uno de ellos se descartaba al importar: una relación solo se importa cuando ambos extremos viajan con ella. Por eso los Deployments no aparecían enlazados a sus Pods en el canvas aunque el discovery sí encontraba esos vínculos.
- Los recursos que ya están en el proyecto ahora se envían como contexto, de modo que esas relaciones sobreviven. Reenviarlos es idempotente: el servidor los fusiona con los nodos existentes por identidad en vez de duplicarlos.
- Lo mismo ocurría con las importaciones de AWS y se corrige igual. AWS ahora además recalcula qué recursos ya están presentes en el momento de importar, en lugar de confiar en un preview que pudo cachearse antes de que se agregaran.

### Architecture: los nodos del clúster ahora se identifican como las instancias en la nube donde corren

- Los recursos EC2 que CloudFormation descubre para un clúster EKS son security groups, reglas y launch templates — nunca las instancias en ejecución, porque las instancias de un node group las crea su Auto Scaling group en tiempo de ejecución. Las instancias reales son los nodos del clúster.
- Los nodos descubiertos ahora llevan su id de instancia, zona de disponibilidad, tipo de instancia y, cuando el contexto nombra la cuenta explícitamente (un ARN de contexto EKS), su ARN de EC2. Ese ARN es lo que permite que un nodo en ejecución se correlacione con la misma instancia vista desde AWS.
- Cuando la cuenta no se puede determinar, la identidad de la instancia igual se registra pero no se inventa ningún ARN.

### Observability: una vista de Relaciones para revisar las conexiones descubiertas

- Las relaciones descubiertas que esperaban una decisión solo se contaban, nunca se mostraban: no aparecían en Topology y la única forma de actuar sobre ellas era abrir el canvas de Architecture. Observability ahora tiene una pestaña Relaciones que lista cada una con sus dos extremos, su tipo, la evidencia que la respalda y su estado, con acciones Aceptar y Rechazar. Funciona igual para AWS y Kubernetes, porque lee del registro compartido.
- Aceptar o rechazar desde Observability registra exactamente la misma decisión que el canvas de Architecture, así que las dos vistas nunca pueden contradecirse.
- Las relaciones cuya evidencia declara el propio recurso — un Ingress que nombra su Service, una coincidencia de selector, el nodo donde está agendado un Pod — ahora se confirman automáticamente en vez de pedir una decisión que solo tiene una respuesta sensata. Todo lo inferido por nombres sigue esperando revisión, y una decisión ya tomada por una persona nunca se sobrescribe.
- Las relaciones existentes se reevalúan en la siguiente reconciliación, así que activar esto no obliga a reimportar todo.
- "Relaciones divergentes" ahora es "relaciones por revisar", que es lo que siempre significó: a diferencia de los recursos divergentes, no son un problema a corregir sino una decisión a tomar. El contador ahora es un acceso directo a la nueva vista.

### Observability: la confirmación de recolección ahora también describe Kubernetes

- Confirmar una recolección solo describía Lambda: a una aplicación compuesta íntegramente por recursos Kubernetes se le pedía confirmar "Funciones Lambda: 0" y un presupuesto de lecturas AWS que esa recolección ni siquiera consume.
- La confirmación ahora lista lo que realmente se va a leer, desglosado por tipo de recurso (Deployments, Pods, Services, Ingresses, nodos), y aclara que una recolección de Kubernetes solo lee del clúster y nunca toca el presupuesto de lecturas de AWS. Los detalles de Lambda se muestran solo cuando la aplicación realmente tiene funciones Lambda.
- Su descripción también estaba desactualizada: el uso de Kubernetes ahora puede venir de Prometheus, y el inventario de los Ingress de la API de Kubernetes.

### Corregido: los Secrets y ConfigMaps generaban un error de recolección en cada ejecución

- El colector se invoca para cada recurso Kubernetes de una aplicación, pero solo los workloads, Pods, Services, Ingresses y nodos tienen algo que medir. Un Secret o ConfigMap generaba un error de "kind no soportado" por cada uno, en cada ciclo de recolección.
- Esos kinds ahora se reportan como solo topología, igual que los tipos de recurso de otros proveedores que ningún colector soporta.

### Observability: volumen de logs por workload, y menos espacio desperdiciado en recursos sin métricas

- Los Deployments, StatefulSets, DaemonSets y Pods ahora reportan cuánto log están escribiendo en disco, leído desde Prometheus. Esto responde una pregunta que la API de métricas de Kubernetes nunca pudo, y se recolecta incluso cuando el uso vino de un Metrics Server.
- Si el clúster no tiene Prometheus, el volumen de logs simplemente se omite: una recolección nunca falla por eso, y el clúster se sondea una sola vez en lugar de una vez por recurso en cada ejecución.
- Los tipos de recurso sin colector de métricas (Secrets, ConfigMaps y cualquier tipo futuro) ya no ocupan una sección completa cada uno. Ahora se resumen en una sola línea compacta, dejando el espacio a los recursos que sí reportan algo.
- Se evaluó agregar métricas de requests de los Ingress y deliberadamente no se hizo: este clúster no tiene ningún ingress controller instrumentado en Prometheus, y los conteos de requests de los balanceadores viven en CloudWatch, que es facturable. Los Ingress siguen reportando su inventario de ruteo en vez de números que habría que inventar.

### Observability: los nodos del clúster, los Ingress y los Pods ahora reportan sus propias métricas

- Los nodos del clúster ahora se descubren como recursos y reportan CPU en uso, memoria en uso, Pods alojados y su capacidad de CPU/memoria, leídos del Prometheus que ya corre en el clúster. Los Pods quedan enlazados en el diagrama al nodo que los ejecuta.
- Los Ingress ahora reportan su inventario de ruteo (reglas, rutas, hosts y hosts con TLS) leído desde la API de Kubernetes. El tráfico del ingress controller deliberadamente no se reporta, porque no hay garantía de que algún controller esté siendo recolectado por Prometheus e inventar esos números sería engañoso.
- Los Pods ahora se recolectan directamente en vez de fallar: antes cada Pod de una aplicación generaba un error de tipo no soportado en cada recolección.
- Listar los nodos del clúster requiere un permiso a nivel de clúster que muchos roles no tienen. Cuando se deniega, el discovery ahora degrada esa capacidad y conserva todo lo demás, en vez de hacer fallar todo el escaneo de Kubernetes.
- Cada sección de recursos ahora comienza con cuántos recursos de ese tipo tiene la aplicación, y ya no repite contadores que no le corresponden: los Pods muestran uso y reinicios en vez de un par listos/total que solo repetía la propia sección, y los Services muestran los Pods a los que enrutan en vez de duplicar la CPU y memoria de su workload.

### Observability: los KPI y gráficos ahora se organizan por tipo de recurso

- El Overview mostraba una única fila plana de KPI y una sola grilla de gráficos, fijada a Lambda y Kubernetes. Ahora las métricas se agrupan en una sección por tipo de recurso — y por kind de Kubernetes (Deployments, Pods, Services, Ingresses...) — cada una con sus propios KPI, gráficos y conteo de recursos.
- Las series de métricas ahora se pueden pedir filtradas por tipo de recurso y kind de Kubernetes, para que un gráfico muestre solo los recursos a los que corresponde en vez de un único total del clúster.
- Los tipos de recurso que Architecture ya descubre pero para los que aún ningún colector reporta métricas (S3, SQS, SNS, DynamoDB, Ingresses, ConfigMaps, recursos de GCP y Vercel) ahora se listan explícitamente con una nota que aclara que solo se correlacionan para la topología, en vez de omitirse en silencio.
- Qué métricas corresponden a cada tipo de recurso ahora vive en un único catálogo independiente del proveedor, así que agregar métricas de EC2, Cloud SQL o cualquier proveedor futuro es una entrada en ese catálogo en vez de cambios repartidos por las vistas de Observability.
- Los KPI de uso de Kubernetes ya no afirman que su fuente siempre es `metrics.k8s.io`, dado que el uso ahora puede provenir de Prometheus.

### Corregido: el uso de CPU/memoria de Kubernetes nunca llegaba realmente a Prometheus

- Cuando un clúster no tiene Metrics Server, el uso de CPU/memoria de Kubernetes en Observability recurre a consultar un Service de Prometheus descubierto — pero ese respaldo siempre fallaba en un clúster real (reportado silenciosamente como "Métricas no disponibles"), aunque ese mismo Prometheus ya era alcanzable desde el panel de detalle del recurso.
- El colector armaba la solicitud proxy a Prometheus a través de un helper del cliente de Kubernetes que codifica toda la ruta de la consulta PromQL como un único segmento de URL, corrompiéndola antes de que llegara al clúster. Ahora arma la solicitud proxy directamente, de la misma forma comprobada que ya usa el panel de detalle del recurso.
- Las gráficas de CPU y memoria de Kubernetes y el resumen "CPU promedio"/"Memoria promedio" ahora se completan correctamente para clústeres que dependen de Prometheus en lugar de Metrics Server.

### Corregido: recursos Kubernetes duplicados entre Architecture y Observabilidad

- Una aplicación Kubernetes alojada en AWS (por ejemplo EKS) guarda `aws` como proveedor del recurso para sus workloads, mientras que el adaptador Kubernetes de Architecture siempre usaba `kubernetes`. El registro compartido trataba esto como dos recursos distintos, por lo que el mismo Deployment podía aparecer dos veces — una vez desde APM y otra desde Architecture — en la tabla de recursos de Observabilidad y en el registro.
- Los nodos de discovery Kubernetes ahora llevan una clave estable `contexto/namespace/kind/nombre` (la misma que APM ya usa para workloads agregados manualmente o descubiertos por EKS), y cada lugar que convierte un recurso APM en nodo del grafo (o viceversa) ahora normaliza el proveedor a `kubernetes` en lugar de confiar en la nube donde corre la aplicación.
- Los duplicados existentes se autocorrigen en la próxima reconciliación del registro compartido (colección automática, reconciliación manual o cualquier cambio de recurso en APM/Architecture) — no se requiere migración manual de datos.
- Se generalizó la corrección como regla reutilizable: el proveedor de un recurso ahora siempre se deriva de lo que el recurso realmente es (`resourceOwnProvider` en applicationRegistryService.js), nunca se hereda de la nube donde corre su aplicación, tanto para la proyección APM→Architecture como Architecture→APM.

### Architecture Fase 9: persistencia del contexto de aplicación

- El contexto activo de la KUA Application (aplicación, proyecto, proveedor y perfil) ahora persiste en almacenamiento local y se restaura al recargar, por lo que recargar la ventana ya no pierde la aplicación Architecture seleccionada.
- El perfil de Architecture ya no fuerza el selector global de perfil AWS cuando la aplicación ya tiene su propio perfil (por ejemplo, una aplicación solo Kubernetes); solo recurre a él cuando no hay ninguna aplicación activa.

### Architecture Fase 10: navegación a nivel de recurso

- El inspector de nodos del Canvas ahora expone acciones de navegación contextuales: los workloads/Pods de Kubernetes pueden abrir sus logs, el detalle YAML/métricas (reutilizando el panel de detalle Kubernetes existente) y la lista de Pods propios; los nodos Lambda, EC2, EventBridge y Step Functions de AWS pueden abrir los logs de Lambda o saltar directamente a la pestaña de AWS correspondiente filtrada por nombre.
- Los tipos de recurso no soportados no muestran sección de navegación en lugar de una acción rota o vacía.

### Architecture Fase 11: overlay de salud en el Canvas

- El Canvas suma un toggle opcional "Health" que muestra una insignia en cada nodo: degradado/saludable para workloads y Services Kubernetes usando la salud ya capturada durante el discovery, y una insignia de obsoleto para recursos ausentes en la última sincronización.
- La preferencia del overlay persiste junto con el resto de la vista del canvas y no altera el layout del diagrama, manteniendo legibles los diagramas densos cuando está desactivado.

### Architecture Fase 12: vista canónica de Resources

- Architecture suma una pestaña "Resources" que lista el registro compartido de la KUA Application enlazada: proveedor, tipo de recurso, scope/ubicación, fuentes que lo confirman (APM, Architecture o ambas) y cantidad de relaciones.
- Los recursos confirmados desde un solo lado (APM o Architecture) se marcan como divergencia de fuente única en vez de fusionarse silenciosamente.
- El estado operativo reutiliza la señal de salud/obsolescencia de la Fase 11 ya disponible en el nodo del grafo Architecture, sin una nueva canalización de telemetría.
- El endpoint del registro compartido (`GET /apm/applications/:id/registry`) ahora informa qué fuentes confirmaron cada recurso.

### Architecture Fase 13: menos revisiones sorpresa por la reconciliación del registro compartido

- Reconciliar el registro compartido tras una operación de Architecture podía generar hasta dos revisiones adicionales del grafo sobre el guardado propio del usuario (una por proyectar recursos APM faltantes al grafo, otra por sellar los ids de correlación del registro). Ambas mutaciones ahora se fusionan en un solo documento de trabajo y se guardan como máximo una vez, por lo que una acción del usuario produce como máximo una revisión derivada en vez de hasta dos.

### Architecture Fase 14: diagnóstico visible de sincronización del registro compartido

- Cada reconciliación del registro compartido (manual o automática) ahora persiste un diagnóstico: hora y duración de la última sincronización exitosa, último error, y cuántos recursos/relaciones están confirmados desde un solo lado (APM o Architecture).
- La vista de aplicación de Observability ahora muestra este diagnóstico como una franja de estado persistente en vez de un aviso puntual, con una acción "Retry sync" que reutiliza el endpoint de reconciliación existente.
- Una sincronización fallida ya no borra la última sincronización exitosa conocida ni sus conteos de divergencia.

### Architecture Fase 15: Routes con sus propios filtros de proveedor/contexto/namespace

- Routes ya respetaba los filtros persistidos de proveedor/contexto/namespace del Canvas, pero solo el Canvas podía cambiarlos. Routes ahora tiene los mismos controles de filtro en su propia barra de herramientas, escribiendo al mismo estado de vista compartido, sin necesidad de cambiar a Canvas para acotar las rutas.

### Architecture Fase 16: sugerencias de relaciones deterministas basadas en logs

- Los nodos de workload/Pod Kubernetes suman una acción "Suggest relationships from logs" que analiza el stream de logs ya abierto en busca de referencias DNS internas (`servicio.namespace.svc.cluster.local`) y propone relaciones `calls` hacia los nodos Kubernetes coincidentes del mismo diagrama.
- La extracción es completamente determinista (sin IA/ML) y se sanitiza antes de guardarse como evidencia: primero se redactan patrones comunes de secretos (encabezados Authorization, tokens, API keys, contraseñas), y solo se conserva una muestra corta más un conteo de ocurrencias, nunca el log crudo completo.
- Cada sugerencia se agrega con `status: suggested` y confianza menor a 1, pasando por el mismo flujo de revisión de aceptar/rechazar que ya se usa para el discovery automático — nada se agrega al grafo sin confirmación humana explícita.
- La librería de extracción también agrupa firmas de errores recurrentes y recolecta ids de correlación/request/trace distintos para fases futuras, sin persistir ni mostrar el contenido crudo del log más allá de la vista de terminal existente.

## v1.14.1 (2026-08-26)

### Reconciliación de recursos AWS heredados

- La reconciliación de Architecture ya no falla cuando un nodo AWS legado no incluye `provider`; usa el provider de la KUA Application enlazada.
- Los nodos AWS con ARN recuperan automáticamente cuenta y región para compartir una identidad única con el recurso APM, evitando duplicados en el registro.
- Los nodos incompletos no proyectables se omiten de forma segura y se agregó una prueba de regresión para aplicaciones serverless como `syn agent-call`.

## v1.14.0 (2026-08-26)

### Recursos compartidos y análisis de topología AWS

- El análisis de topología AWS ahora separa recursos y relaciones AWS de las membresías Kubernetes mixtas, conservando la topología completa de la aplicación en la respuesta.
- La resolución de referencias AWS es segura ante datos incompletos y las funciones y state machines serverless de CloudFormation/SAM conservan su semántica Lambda/Step Functions.
- El discovery Architecture deriva la cuenta AWS desde los recursos del preview cuando el scope seleccionado no la entrega.
- Las aplicaciones enlazadas ahora reconcilian recursos observables en ambos sentidos: los recursos agregados en APM aparecen en una vista Architecture existente y los nodos compatibles AWS/Kubernetes/GCP/Vercel de Architecture se proyectan en APM sin duplicarse.
- Los proveedores Kubernetes se persisten explícitamente cuando es necesario, y las membresías proyectadas desde Architecture se eliminan al retirar su nodo de origen.
- Se agregó cobertura de regresión para análisis mixto AWS/Kubernetes, proyección bidireccional, normalización serverless y migración de esquema a v1.14.

## v1.13.0 (2026-08-26)

### Workspace Architecture centrado en la aplicacion

- Architecture ahora carga y muestra primero el catalogo de KUA Applications, selecciona la aplicacion activa y limita sus vistas Architecture a esa aplicacion.
- El workspace Architecture ahora expone juntos identidad, proveedor, entorno, equipo, scopes activos y estado del enlace junto con la revision del diagrama.
- Crear o refrescar una vista Architecture conserva el `applicationId` seleccionado; los proyectos heredados sin enlace siguen disponibles como ruta de compatibilidad.

## v1.12.0 (2026-08-26)

### Endurecimiento del shell de KUA Application

- Architecture ahora acepta un contexto de aplicacion, acota la carga de proyectos a la KUA Application enlazada y vincula los proyectos nuevos con esa aplicacion.
- Architecture y Observability exponen navegacion reversible para aplicaciones Kubernetes genericas y proveedores cloud, con un contexto compartido que muestra identidad, entorno y equipo.
- La conciliacion del registro ahora se ejecuta despues de eliminar proyectos, desenlazar, restaurar snapshots y otras mutaciones del grafo, eliminando membresias y relaciones Architecture obsoletas.
- Los nodos Kubernetes heredados se normalizan desde su `kind` nativo, evitando que Deployments, Services, Pods y otros recursos existentes se rendericen como clusters genericos.
- Los filtros persistidos de proveedor, contexto y namespace ahora se aplican tanto en Canvas como en Routes, y el control GitHub usa el SVG incluido sin avisos de Lucide.

### Architecture Fase 8: Base del Adaptador Kubernetes (2026-08-26)

- La vista Routes ahora es neutral al proveedor: conserva los caminos APL de eventos/workflows y agrega caminos de **Microservicios** para flujos Kubernetes `Ingress -> Service -> Pod` y sus dependencias declaradas de configuracion o almacenamiento.
- La evidencia de rutas Kubernetes sigue siendo declarada y explicable. El futuro analisis frecuente de logs producira sugerencias observadas, acotadas por privacidad y sujetas a revision, nunca relaciones automaticas desde texto de logs crudo.
- El preview Kubernetes de Architecture ahora acepta uno o varios filtros de namespace y agrupa los recursos seleccionables por tipo, con seleccion por grupo para workloads, Pods, Services, Ingress, ConfigMaps, Secrets y persistent volumes.
- Los diagramas Kubernetes ahora usan un tratamiento visual dedicado para el cluster e iconos distintos para workloads, Pods, Services, Ingress, ConfigMaps, Secrets y persistent volume claims.
- El discovery Kubernetes incluye el enrutamiento de Services e Ingress, mas solo los ConfigMaps, Secrets y PVCs referenciados explicitamente por entorno o volumen del workload; estas dependencias se dibujan con relaciones `uses` basadas en evidencia.
- Architecture ahora admite recursos manuales explicitos junto al discovery: se pueden agregar instancias EC2 o cualquier componente AWS, ademas de recursos Kubernetes, GCP o Vercel, registrando proveedor, identidad nativa estable, ambito y ubicacion en el grafo.
- Architecture ahora usa un unico menu **Add resources** en lugar de una accion solo AWS: los previews e imports AWS y Kubernetes estan disponibles hoy, mientras GCP y Vercel aparecen como adaptadores de proveedor planificados.
- El discovery Kubernetes de Architecture lista contextos, previsualiza un contexto seleccionado explicitamente con salud y evidencia de relaciones, e importa solo los recursos confirmados y sus relaciones internas en una revision del grafo.
- Las aplicaciones con recursos Kubernetes confirmados ahora actualizan automaticamente su preview de topologia acotado despues de cargar, consultando solo sus contextos configurados; al abrir el preview se reutiliza ese resultado.
- Al crear una vista Architecture desde Observability, el nuevo diagrama ahora incluye los recursos y dependencias confirmados de la aplicacion en lugar de abrir un grafo vacio.
- Observability Kubernetes ahora usa como fallback un Service Prometheus detectado dentro del cluster para el uso agregado de CPU y memoria de Pods cuando `metrics.k8s.io` no esta disponible, conservando cursores de reinicios estables entre fuentes.
- Las senales de disponibilidad, total y reinicios de Pods ahora permanecen completas cuando `metrics.k8s.io` no esta disponible; Observability identifica explicitamente que solo faltan los datos de uso de CPU y memoria.
- Observability ahora deriva KPIs, graficas, analisis cloud y controles de trazas desde las capacidades de recursos confirmados, por lo que las aplicaciones solo Kubernetes no muestran senales Lambda ni analisis exclusivos de AWS.
- Los Pods, Deployments, StatefulSets y DaemonSets Kubernetes configurados ahora exponen su streaming de logs existente directamente desde Observability, cambiando al contexto Kubernetes asociado antes de resolver los Pods del workload.
- La configuracion de Observability ahora carga los clusters Kubernetes compatibles antes de detectar workloads y consulta solo el cluster EKS elegido explicitamente, con estados separados para carga de clusters y workloads.
- El flujo de configuracion trata Kubernetes como un ambito explicito de la aplicacion y reutiliza una seleccion de contexto segun proveedor preparada para GKE y conexiones Kubernetes generales, sin cambiar las reglas de membresia confirmada.
- El preview de topologia Kubernetes ahora lista primero los clusters compatibles y exige seleccionar uno antes de consultar workloads, Services, Ingress y eventos, evitando escaneos innecesarios de varios clusters.
- Nuevo feedback visible de carga mientras KUA lista clusters y mientras lee los recursos Kubernetes del cluster elegido.
- Nuevo adaptador Kubernetes de topologia solo lectura con identidades estables de contexto, namespace y UID para workloads, pods, Services e Ingress.
- Los previews Kubernetes ahora aportan evidencia declarada de selectores e Ingress, senales de salud de workload/pod, resumenes de eventos Warning y capacidades por contexto que se degradan de forma segura si una API no esta disponible.

### Base de Architecture Fase 6 (2026-08-26)

- Nuevo registro compartido neutral al proveedor para recursos, membresias y relaciones de KUA Application, basado en identidades estables y conservando el linaje de cada fuente por separado.
- Nueva conciliacion explicita de datos APM y Architecture enlazados, que proyecta identificadores de correlacion a nodos y relaciones sin mover buckets metricos, cursores ni trazas de sus almacenes locales actuales.

### Base de Architecture Fase 5 (2026-08-26)

- Nuevo enlace reversible y aislado por perfil entre una aplicacion de Observability y un proyecto Architecture existente o nuevo, sin mover recursos, metricas, trazas ni datos del grafo.
- Observability ahora muestra la cobertura del enlace Architecture, recursos sin correspondencia y advertencias de identidad duplicada, y abre el diagrama enlazado exacto en una accion.

### Inicio de Architecture Fase 4 (2026-08-26)

- Nueva aplicacion autoritativa de sync CloudFormation con una revision atomica del grafo, proteccion optimista `expectedRevision`, metadata de stacks seleccionados e identidades estables conservadas.
- La revision de sync ahora muestra recursos concretos por categoria, conserva decisiones manuales y relaciones rechazadas, marca como stale los recursos ausentes y permite restaurarlos o eliminarlos explicitamente.
- Nuevo plan de Gestion Unificada de KUA: define KUA Application como limite compartido entre APM y Architecture y ordena la migracion hacia un workspace de aplicaciones neutral al proveedor.
- Nuevo contrato de fase 4 para sincronizacion autoritativa CloudFormation, ciclo de vida stale, metadata de sync y revision de relaciones.
- Primer hito documentado como una revision segura de sync CloudFormation que compara fuentes de stacks seleccionados antes de aplicar una sola revision del grafo.
- Primer endpoint read-only de sync preview AWS, clasificando recursos y relaciones CloudFormation seleccionados como nuevos, modificados, sin cambios, ausentes, stale, manuales, reforzados o rechazados sin mutar el grafo.
- Nuevo panel de sync preview en el workspace Architecture para revisar fuentes CloudFormation existentes y resumir cambios de recursos y relaciones antes de implementar el flujo de apply.

### Cierre de Architecture Fase 3 (2026-08-25)

- El redescubrimiento ahora reconcilia identidades AWS actuales e historicas sin duplicar nodos y remapea relaciones, grupos y posiciones al ID conservado.
- Las decisiones manuales y relaciones rechazadas siguen prevaleciendo al importar de nuevo los mismos recursos y evidencias.
- El modo de orden del Canvas, su direccion y la preferencia de etiquetas ahora se guardan en el grafo versionado, se restauran al recargar y aparecen en comparaciones de snapshots.
- El discovery AWS ahora indica si se cargan stacks CloudFormation o se analizan recursos y evidencias, con una espera visible durante lecturas demoradas.
- Los proyectos Architecture ahora se pueden eliminar explícitamente, incluyendo su grafo local, snapshots e historial de revisiones.
- Un redescubrimiento real de los tres stacks AFEX conservó 119 nodos sin duplicados y registró nueva evidencia de relaciones disponible.
- Las versiones de capas Lambda ahora se modelan como capas con el nombre de la capa, en lugar de funciones cuyo nombre era una versión numérica.
- Los permisos Lambda de API Gateway se consolidan como evidencia de ruta a Lambda, en vez de nodos policy repetidos; al seleccionar una Lambda se muestran sus rutas API, permisos y la identidad CloudFormation.
- Nuevo contrato bilingue de fase con criterios de aceptacion explicitos; la sincronizacion autoritativa queda diferida a fase 4.
- Validacion de cierre aprobada: 118 pruebas backend, 374 pruebas frontend, build de produccion y build de documentacion VitePress.

### Base del espacio Architecture

- Nuevo espacio **Architecture** aislado por perfil para diagramas de aplicaciones, inicialmente orientado a AWS.
- Nuevo modelo de grafo independiente del proveedor para ámbitos, fuentes, nodos, relaciones, grupos, evidencia y layout persistente.
- Nuevo almacenamiento privado `architecture.sqlite3` con WAL, revisiones optimistas del grafo, snapshots inmutables y cierre seguro del servidor.
- Nuevas APIs aisladas por perfil para crear proyectos, leer y actualizar borradores del grafo, y crear o consultar snapshots.
- Primer workspace Vue para crear proyectos, consultar el resumen del grafo y mantener historial local de snapshots.
- Nuevas operaciones tipadas del grafo con limpieza en cascada, control optimista de revisiones e historial semántico de cambios.
- Comparación y restauración transaccional de snapshots, creando siempre una nueva revisión y un snapshot inmutable sin reescribir el historial.
- Nuevos controles del workspace para comparar snapshots, restaurar estados anteriores y consultar el historial reciente de revisiones.
- Nuevo canvas interactivo con Vue Flow para crear, conectar, mover, editar y eliminar componentes de arquitectura manualmente.
- Las interacciones del canvas persisten mediante operaciones tipadas, incluyendo cambios de layout registrados sólo al terminar cada movimiento.
- Nuevo discovery AWS de sólo lectura para deployments CloudFormation activos y servicios ECS, aislado por perfil/región y con estimación de requests.
- Nuevo flujo de preview y confirmación en dos pasos: KUA nunca preselecciona recursos y los recursos confirmados se importan atómicamente con sus relaciones inferidas.
- Nuevas sugerencias de relaciones con evidencia desde referencias CloudFormation `DependsOn`, `Ref`, `GetAtt` y `Sub`, incluyendo sintaxis YAML abreviada.
- Las relaciones inferidas se clasifican como automáticas o sugeridas según el umbral de confianza del proyecto, conservando su confianza y evidencia de origen.
- Nuevas acciones explícitas para aceptar o rechazar relaciones; las decisiones revisadas se conservan al redescubrir y las relaciones rechazadas permanecen en el historial canónico aunque se oculten del canvas.
- Nueva semántica AWS para targets de EventBridge, definiciones Step Functions y ubicación de servicios ECS, además de relaciones directas SQS a Lambda inferidas desde event source mappings de CloudFormation.
- Nuevo inventario regional directo para Lambda, EventBridge y Step Functions, usando los stacks CloudFormation como enriquecimiento opcional en lugar de exigirlos para el discovery.
- Los recursos AWS conectados ahora se identifican como aplicaciones candidatas mediante evidencia de targets EventBridge y ASL, listas para selección explícita; los previews truncados al límite de 500 recursos se informan claramente.
- Las aplicaciones identificadas ahora se dibujan directamente con una acción: el preview validado se reutiliza durante cinco minutos, el panel de discovery se cierra después de importar y los diagramas grandes reciben un layout adaptativo más ancho.
- Nuevo discovery regional directo de event source mappings de Lambda para completar rutas SQS a Lambda sin depender de CloudFormation.
- Nuevo diagrama APL con modos Secuencia de eventos, Nombre A-Z, Event bus, Flujo de servicios y Ruta más larga; el orden se aplica a entradas y ramas preservando caminos con relaciones distintas.
- Los nuevos proyectos Architecture ahora abren una configuración guiada CloudFormation-first: elegir deployments, confirmar recursos inferidos y revisar el diagrama, con inventario regional como alternativa explícita.
- Los recursos Step Functions ahora abren su diagrama ASL interno configurable desde Routes o Canvas, mientras la composición del candidato indica qué aplicaciones contienen workflows y otros tipos de recursos AWS.
- Architecture ahora puede mapear todos los recursos de los stacks CloudFormation seleccionados explícitamente, incluyendo recursos aislados y servicios AWS antes no soportados, sin ampliar el contrato de recursos de APM.
- La evidencia CloudFormation ahora identifica notificaciones S3, asociaciones de roles y policies IAM, roles usados por workloads, permisos Lambda y recursos gobernados mediante relaciones semánticas específicas.
- El Canvas puede ordenar el curso de solicitudes horizontal o verticalmente mediante niveles causales persistidos y reducción de cruces; los diagramas densos parten de un zoom legible, con etiquetas opcionales e iconos AWS reconocibles.
- Los métodos API Gateway y rutas HTTP API ahora muestran su método y path resueltos, conservan evidencia directa de ruta a Lambda y exponen referencias navegables en el inspector del Canvas.
- Al seleccionar un componente, el Canvas ahora lo centra con zoom legible y atenúa nodos y relaciones no vinculados, manteniendo visibles las dependencias directas en topologías densas.
- Al limpiar la selección del Canvas ahora se restaura explícitamente la visibilidad completa de todos los nodos y relaciones, incluso cuando Vue Flow haya mutado sus estilos internos.
- Nuevo modo de orden por tipo de recurso con secciones etiquetadas y contador, rejillas deterministas, posiciones persistidas y conectores rectos tenues para diagramas grandes.
- El discovery Architecture consume el presupuesto AWS existente por perfil; las plantillas se analizan localmente y nunca se persisten ni se devuelven al frontend.
- Cobertura backend y frontend para validación del grafo, inmutabilidad de snapshots, conflictos de revisión, aislamiento por perfil y comportamiento del store.

## v1.11.3 (2026-08-11)

### Hotfix de empaquetado macOS

- Se corrigió el paquete de macOS Intel que incluía el binario nativo ARM64 de `better-sqlite3`, lo que impedía iniciar el backend después de instalar la aplicación.
- Los artefactos macOS x64 y ARM64 ahora se generan en procesos aislados y secuenciales para impedir que una dependencia nativa sea reemplazada mientras se archiva otra arquitectura.
- Se agregaron validaciones de arquitectura para el ejecutable Electron y el módulo nativo SQLite dentro de ambos ZIP finales antes de publicar un release.
- Se conserva un manifiesto de actualización macOS combinado con los artefactos ZIP/DMG para x64 y ARM64.

## v1.11.2 (2026-08-11)

### APM multicloud y sin proveedor

- Se extendió la observabilidad de aplicaciones desde AWS a ámbitos aislados para AWS, GCP y Vercel, más un ámbito **General** sin proveedor para aplicaciones Kubernetes.
- Observabilidad ahora forma parte de la navegación principal e incluye edición, eliminación, gestión de recursos y configuración según el proveedor.
- Se agregaron migraciones SQLite por columnas explícitas para aplicaciones y recursos por proveedor, conservando de forma segura los datos APM existentes.
- Nuevas guías bilingües de credenciales para AWS, GCP, Vercel y Kubernetes, con persistencia de perfiles corregida y carga diferida por proveedor.

### Inteligencia de topología explicable

- Nuevo evaluador estructural local con puntuación, cobertura conectada, detección de recursos aislados, hallazgos y sugerencias de dependencia explicables.
- Las relaciones genéricas `related_to` se informan por separado y no cuentan como causalidad operacional.
- Nuevo análisis AWS explícito y de solo lectura para las definiciones de Step Functions asociadas.
- El análisis ASL reconoce invocaciones Lambda directas y optimizadas, subflujos Step Functions, envíos SQS, tareas ECS y operaciones SDK de S3.
- Las referencias ASL externas siguen siendo sugerencias: el usuario debe agregar el recurso, analizar nuevamente y confirmar la dependencia. KUA nunca crea relaciones causales automáticamente.

### Requests de procesos y trazas de ejecución

- Nueva pestaña AWS **Trazas** que acepta request/correlation ID, ARN de ejecución o ARN de una Step Function asociada.
- Al pegar el ARN de una Step Function se muestran hasta 10 ejecuciones recientes y se traza la última; luego se puede seleccionar directamente cualquier ejecución de la lista.
- El historial de Step Functions genera un timeline ordenado con Lambda, ECS, S3, subflujos, estados, duración y evidencia de fallos.
- Nueva opción explícita **Mostrar request/response sanitizados** para entradas, parámetros, salidas, errores y causas de la ejecución y de cada paso.
- Los campos habituales de credenciales y datos personales se ocultan, strings y arrays grandes se limitan, los payloads se solicitan sólo bajo demanda y las trazas nunca se persisten.
- Todas las lecturas de trazas y topología permanecen limitadas a recursos asociados y consumen el presupuesto AWS por perfil. KUA no invoca workloads productivos ni habilita logging automáticamente.

### Correcciones Vercel y estabilidad

- Se actualizaron rutas y versiones API de Vercel, se conservaron errores upstream y se soportan las respuestas Cron actuales y antiguas.
- Se corrigieron textos por proveedor, manejo de perfiles, comportamiento de Env Manager y presentación de recursos en las vistas multicloud.
- Se agregó cobertura backend y frontend para migraciones, scoping, extracción ASL, evaluación de topología, trazas, sanitización, compatibilidad Vercel y perfiles.

## v1.11.0 (2026-08-06)

### Observabilidad local de aplicaciones

- Nuevo espacio de aplicaciones por perfil para recursos Lambda, Kubernetes, SQS, EventBridge, Step Functions y ECS confirmados explícitamente.
- Discovery read-only de despliegues CloudFormation y ECS con preview antes de importar. KUA nunca selecciona candidatos ni crea dependencias automáticamente.
- Almacén privado SQLite con agregados UTC de 30 minutos, umbrales locales, cursores de recolección, historial de ejecuciones, retención y health checks.
- Colectores Lambda y Kubernetes con paginación reanudable, deduplicación, estados parciales y captura oportunista de métricas ya cargadas en la interfaz.
- Topología manual por aplicación, umbrales de salud configurables, tendencias locales e historial de métricas aislado por perfil.

### EKS Container Insights

- Nuevo dashboard de observabilidad EKS basado en consultas read-only a CloudWatch Container Insights.
- Las métricas se pueden agrupar por namespace, workload, pod o nodo, mostrando contexto del clúster y sus node groups junto a las series.
- La recolección informa cuando Container Insights no está disponible o devuelve datos parciales, sin provisionar agentes, dashboards, alarmas ni otros recursos AWS.

### Controles de coste y privacidad

- El polling automático APM permanece desactivado por defecto y la recolección se habilita explícitamente por aplicación.
- Límite local estricto de 100.000 lecturas AWS por perfil y mes calendario.
- KUA almacena sólo identificadores confirmados, configuración, cursores, contadores, estado de recolección y agregados. No persiste líneas de CloudWatch Logs, payloads, credenciales, secretos, variables de entorno ni tags arbitrarios.
- Los buckets, cursores y ejecuciones expiran a los 90 días; los registros de presupuesto expiran a los 15 meses.

### Estabilidad de refresco y terminal

- Refresco silencioso y estable cada 5 segundos para Kubernetes, AWS, GCP y Vercel, pausado cuando la ventana está oculta.
- Cachés en memoria stale-while-revalidate para listados cloud y Kubernetes, invalidadas después de mutaciones y cambios de contexto.
- El refresco en segundo plano conserva la identidad de datos sin cambios e ignora respuestas obsoletas después de navegar entre recursos.
- Terminal Logs conserva hasta 5.000 líneas, renderiza ventanas de 1.000, permite pausar/reanudar el seguimiento y seleccionar un pod individual para logs de workloads.

### Compatibilidad runtime y Kubernetes

- Reparación idempotente de módulos nativos para `better-sqlite3`, soporte de unpack/rebuild en Electron, permisos privados para la base y puerto Vite estricto.
- Actualización de patches Kubernetes para las firmas actuales del cliente y eliminación de campos administrados por el servidor antes de aplicar YAML editado.
- Cierre limpio del scheduler/base APM y health reporting en el backend local.

## v1.10.5 (2026-07-07)

### Estabilidad de desarrollo y release

- Separación de puertos para backend estable (`7190`), backend de desarrollo/Electron (`7192`) y frontend Vite (`7193`).
- Workaround en el workflow de release para módulos nativos opcionales que podían fallar durante electron-rebuild multiplataforma.

## v1.10.4 (2026-06-22)

### OAuth de Vercel Marketplace

- Soporte completo para el flujo de integración de Vercel Marketplace: la página de callback ahora maneja `configurationId`, `teamId`, `next` y `source` además del flujo estándar OAuth con `code`+`state`.
- Corregido el error "Missing OAuth parameters" que aparecía cuando Vercel Marketplace redirigía al callback sin parámetro `state`.
- Al completar la autorización de Marketplace, la app abre la URL `next` de Vercel en el navegador para que la integración quede marcada como instalada.
- `VERCEL_CONFIGURATION_ID` y `VERCEL_TEAM_ID` del flujo Marketplace se persisten en el perfil de credenciales.

## v1.10.3 (2026-06-22)

### Callback OAuth de Vercel

- Se cambió el redirect OAuth de Vercel a la página HTTPS `https://lnavarrocarter.github.io/kuadashboard/vercel-callback` para completar la autorización sin depender del redirect con protocolo custom.
- Se agregó una página de callback con auto-forward que devuelve `code` y `state` a la app de escritorio usando el flujo existente de Vercel.
- Se agregó soporte para `VERCEL_OAUTH_REDIRECT_URI` en la configuración runtime para que los builds locales y empaquetados queden alineados con el callback HTTPS.

## v1.10.2 (2026-06-22)

### AWS — Credenciales temporales + SSO en navegador

- Soporte completo para `AWS_SESSION_TOKEN` en perfiles guardados y resolución de credenciales AWS, habilitando sesiones temporales de STS de extremo a extremo.
- Nuevo flujo de autorización por dispositivo de IAM Identity Center (SSO) desde navegador, con selección de cuenta/rol y captura automática de credenciales temporales.
- Seguimiento de expiración de sesión SSO y renovación con un clic mediante metadata persistida (`meta.__sso`).

### Seguridad, estabilidad y UX

- Restricción a localhost para endpoints de perfiles locales de AWS y bootstrap SSO, evitando exposición remota de configuración local de la estación de trabajo.
- Ajuste de sanitización en Env Manager para conservar metadata estructurada reservada en `meta.__sso` (start URL, región, cuenta/rol y expiración), manteniendo el comportamiento previo de tags para claves normales.
- Endurecimiento de apertura de ventana SSO usando `noopener,noreferrer`.
- Normalización de finales de línea en `public/index.html` para eliminar `CR` residuales y reducir diffs ruidosos.

### Fixes AWS adicionales

- Corregido el congelamiento del render de diagramas de Step Functions en máquinas de estado con ciclos, agregando una protección de ciclo en la asignación BFS de niveles (`StepFnDiagram.vue`).
- Corregidos los fallos de ejecución en Athena cuando el workgroup no tiene output location configurado, permitiendo definir un override S3 explícito en el Query Editor y en el modal de consulta por workgroup.

## v1.10.0 (2026-06-09)

### GCP — Paneles master-detail

Los cuatro servicios principales de GCP estrenan un layout completo de panel dividido: lista de recursos a la izquierda y panel de detalle con tabs a la derecha, coherente con el patrón ya establecido en Cognito, Athena y Lex.

- **Cloud Run** — tabs: Overview (configuración, imagen, escalado), Revisions (con % de tráfico), Variables (vars de entorno), Logs, Metrics.
- **Compute VMs** — tabs: Overview (tags, labels, protección de borrado), Discos, Red (interfaces e IPs), Logs, Metrics.
- **Cloud SQL** — tabs: Overview (backup y disponibilidad), Config (tipo de almacenamiento, flags), Connection (direcciones IP, connection name), Logs, Metrics.
- **Cloud Functions** — tabs: Overview (runtime, recursos, trigger), Variables, Logs, Invoke (inline, reemplaza el modal flotante anterior), Metrics.

### GCP — Métricas Cloud Monitoring embebidas

El tab **Metrics** se incluye ahora en los cuatro paneles de servicio. Muestra tres gráficas de línea (Chart.js) obtenidas desde la API Cloud Monitoring v3, con selector de rango (1h / 3h / 6h / 24h) y botón de actualización.

| Servicio | Gráficas |
| --- | --- |
| Cloud Run | Request Rate (req/s) · Latency p99 (ms) · Instance Count |
| Compute VMs | CPU Utilization (%) · Network In (B/s) · Disk Read (B/s) |
| Cloud SQL | CPU Utilization (%) · Connections · Disk Used (bytes) |
| Cloud Functions | Execution Count (req/s) · Duration p99 (ns) · Active Instances |

### GCP — GCS Upload y Delete

- **Upload**: nuevo botón "⬆ Upload" en la barra del GCS Browser. Permite seleccionar múltiples archivos, los sube como binario raw a la carpeta actual y muestra un log de resultado por archivo (✓ / ✗).
- **Delete**: botón "🗑 Delete" en el panel de preview del archivo. Pide confirmación antes de llamar a la nueva ruta `DELETE /storage/:bucket/object`.

### GCP — Artifact Registry Deploy-to-K8s

Artifact Registry se rediseña como panel master-detail con dos tabs:

- **Packages & Tags** — vista en dos columnas: lista de packages a la izquierda y tabla de tags a la derecha. Cada fila de tag Docker tiene un botón **🚀 Deploy**.
- **Deploy to K8s** — al pulsar Deploy se rellena automáticamente la referencia completa de imagen (`location-docker.pkg.dev/project/repo/pkg:tag`). El panel permite seleccionar el Namespace, el Deployment y el Container del cluster Kubernetes activo, muestra un resumen del despliegue y aplica el cambio con un clic.

### Integración con Kubernetes

- Nuevo endpoint `POST /api/:namespace/deployments/:name/set-image`: aplica un strategic-merge-patch sobre la imagen de un container específico y escribe una entrada en el audit log.

### GCP — Visor de logs mejorado

- Las entradas de log en todos los paneles de detalle usan colores según severidad: `ERROR`/`CRITICAL` → rojo, `WARNING` → ámbar, `INFO`/`NOTICE` → verde, `DEBUG`/`DEFAULT` → tenue.

## v1.9.3 (2026-06-09)

### AWS Amazon Lex

- Rediseño del módulo Lex con un **layout master-detail de panel dividido** (igual al de Cognito y Athena). El panel izquierdo lista todos los bots con estado, versión y fecha de actualización. Al hacer clic en un bot se abre el panel de detalle a la derecha.
- Se eliminaron los 8 botones de acción de colores de cada fila. Toda la funcionalidad (Intents, Aliases, Slot Types, Chat, Logs, Missed, Metrics, Test Set) ahora está accesible mediante la barra de tabs del panel derecho.
- Los datos se cargan bajo demanda por tab y se cachean mientras el bot esté seleccionado — cambiar de tab para el mismo bot no provoca una nueva llamada a la API.
- Las acciones Chat y Build en el tab de Aliases ahora navegan a sus tabs correspondientes en lugar de abrir modales anidados.

## v1.9.2 (2026-06-09)

### AWS DynamoDB

- Edición de ítems en el modal Browse: cada fila tiene un botón ✏️ que abre un editor JSON pre-llenado con los datos actuales del ítem. Al guardar se ejecuta un `PutItem` (reemplazo completo) y se refresca la página actual.
- Eliminación de ítems por fila: el botón 🗑 extrae automáticamente los campos de la clave primaria desde el key schema de la tabla y pide confirmación antes de llamar a `DeleteItem`.
- Botón **New Item** en la barra del modal Browse: abre el editor JSON pre-llenado solo con los campos de clave para crear un nuevo registro desde cero.
- El editor JSON valida sintaxis en tiempo real y bloquea el guardado si hay errores de parseo.

## v1.9.1 (2026-05-28)

### AWS Cognito

- Búsqueda libre de texto en User Pools sin errores de filtro de AWS.
- Edición de atributos de usuario desde el modal de detalle.
- Gestión de membresía de grupos desde el detalle de usuario: asignar y quitar grupos.
- Controles de MFA por usuario: habilitar, deshabilitar y cambiar método preferido (SMS/TOTP).
- Flujo de creación de grupos con soporte de descripción en el tab Groups.
- Corrección de error en tiempo de ejecución en el flujo de creación de grupos con HMR.
- Corrección del estado MFA en la lista de usuarios alineando el cálculo con los settings de Cognito.

## v1.9.0 (Mayo 2026)

### Vercel

- Integración completa con Vercel mediante autenticación OAuth — conecta tu cuenta directamente desde el modal de perfil.
- Vista de proyectos con estado de deployment, framework, región y acceso directo a la URL en vivo.
- Detalle de deployments con pestañas de Actividad, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config y Checks.

### AWS Step Functions

- Nueva columna **Executions** en la tabla de Step Functions con conteos en vivo de ejecuciones activas (▶), fallidas (✗) y con timeout (⏱).
- Nueva pestaña **Versiones** en el panel Info — lista todas las versiones publicadas del workflow con fecha, descripción y visor de definición ASL con botón de copia.
- Modal Info refactorizado con cinco pestañas: Detalles, Diagrama, Ejecuciones, Eventos y Versiones.

## v1.8.0 (2026-05-10)

### Kubernetes

- Las tablas de recursos ahora soportan seleccion multiple, eliminacion masiva y acciones por fila mas completas.
- El menu de Kubernetes cubre mas recursos de workloads, networking, storage, config, policy, RBAC, scheduling, admission y administracion del cluster.
- La columna `Age` muestra duraciones legibles como `1day 3hrs 10min`, `23hrs 10min`, `2min` y `30sec`, pero ordena por duracion real transcurrida.
- ConfigMaps y Secrets tienen una vista clave/valor mas simple para mapear y editar datos.
- Los workloads muestran variables de entorno en el panel de detalle, incluyendo edicion de entradas por contenedor.
- El modal de kubeconfig permite importar YAML pegado, cargar un archivo desde el selector desktop o registrar una ruta existente.

### Helm

- Los charts se pueden buscar desde repositorios configurados e instalar directamente en el cluster activo.
- Los releases instalados se pueden listar y desinstalar desde la vista Helm.
- Las instalaciones muestran progreso, salida y estado final del release en lugar de dejar la UI esperando sin contexto.
- La instalacion de `metrics-server` incluye un preset de compatibilidad para clusters locales o self-signed, con flags de TLS de kubelet y tipos de direccion preferidos.

### Observabilidad

- Las metricas estan disponibles para Pods, workloads y Nodes usando `metrics.k8s.io`.
- Cuando Metrics Server no esta disponible, KuaDashboard puede detectar servicios Prometheus y consultar metricas mediante el proxy del API server de Kubernetes.
- Los paneles de detalle de recursos y Nodes incluyen eventos relacionados y resumen de notificaciones para diagnosticar scheduling, image pull, salud y ciclo de vida.

### Port Forwarding

- Los tuneles para Services y Pods son mas confiables, con mejor resolucion del pod objetivo, estado persistente y reconexion.
- Las acciones de port-forward estan disponibles desde tablas y detalles cuando el recurso seleccionado soporta tunel.

## v1.7.0 (2026-05-05)

- Auto-refresh para vistas Kubernetes, AWS, GCP y Helm sin resetear el contexto de navegacion.
- Panel lateral Kubernetes ajustable con resumen especializado y YAML estructurado.
- Metricas de Pods usando `metrics.k8s.io`, deteccion de Prometheus y acceso a Helm cuando falta monitoreo.
- Streaming de logs en tiempo real para Pods, Deployments, StatefulSets y DaemonSets.
- Busqueda en Terminal Logs, filtros por fecha serializada, descarga y conteo de lineas.
- Editor YAML con busqueda, lint, guardado, estado linea/columna, ruta de seccion y autocompletado.
- Sesiones EC2 SSH/RDP persistentes que se pueden ocultar y reabrir sin cerrar la conexion.
