# Changelog

## Sin publicar

Continúa el plan de convergencia de KUA Application (Fases 9-16): contexto Architecture persistente, navegación a nivel de recurso, overlays de salud en el Canvas, una vista canónica de Resources compartida, menos revisiones sorpresa del grafo, diagnóstico de sincronización visible, filtros compartidos entre Canvas y Routes, y sugerencias deterministas de relaciones basadas en logs. También corrige un bug real de duplicación encontrado al validar este trabajo.

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
