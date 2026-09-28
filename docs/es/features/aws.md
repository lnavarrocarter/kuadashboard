---
title: Dashboard de Gestión AWS para EC2, EKS, ECS y Lambda
description: Gestiona EC2, EKS, ECS, Lambda, S3, DynamoDB, CloudFront y más servicios AWS desde el dashboard open source KUA.
---

# Integración AWS

KuaDashboard proporciona un panel completo de gestión de AWS accesible desde la barra lateral en **Cloud > AWS**. Ofrece una vista unificada de **22 servicios de AWS** sin salir del dashboard.

> **Novedades en v1.7.0:** las sesiones EC2 SSH/RDP permanecen vivas como tabs restaurables; las mejoras de logs, YAML y métricas de Kubernetes quedan disponibles desde la superficie unificada de operación.

![KuaDashboard — vista general](/screenshots/dashboard-main.png)

## Autenticación

Las credenciales de AWS pueden configurarse de múltiples formas:

| Método | Descripción |
|---|---|
| **Env Manager** | Perfiles nombrados con `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (opcional, para credenciales temporales) y `AWS_DEFAULT_REGION` |
| **AWS CLI** | Lee `~/.aws/credentials` y `~/.aws/config` automáticamente |
| **Perfiles locales** | Selecciona cualquier perfil nombrado de tu `~/.aws/credentials` o `~/.aws/config`, incluyendo perfiles SSO creados con `aws configure sso` |
| **Variables de entorno** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| **Roles IAM** | Al ejecutar en infraestructura AWS (EC2, tarea ECS, Lambda, etc.) |

### Credenciales temporales (STS / IAM Identity Center)

Los perfiles soportan credenciales de sesión temporales — las que emite AWS STS o el portal de acceso de IAM Identity Center (SSO), donde la access key empieza con `ASIA`. Pega los tres valores (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) en el formulario del perfil o impórtalos desde un archivo `.env`. Cuando la sesión expira, el dashboard muestra un mensaje claro pidiendo renovar las credenciales.

Alternativamente, si ya usas `aws sso login` desde la terminal, tus perfiles SSO aparecen en la lista de **perfiles locales** y el SDK resuelve la sesión cacheada automáticamente — sin copy-paste mientras la sesión SSO esté activa.

### Login SSO integrado (sin copy-paste)

Al crear un perfil AWS, elige **"Iniciar sesión temporal (SSO)"**. KuaDashboard detecta tus perfiles SSO de `~/.aws/config` (o pegas la start URL una sola vez), abre el portal de acceso de AWS en tu navegador, y al aprobar captura las credenciales temporales y las guarda en el vault cifrado automáticamente — el mismo flujo de device-authorization que usa el AWS CLI.

El dashboard vigila la expiración de la sesión: las tarjetas de perfil muestran un badge con cuenta regresiva en vivo, y cuando quedan menos de 15 minutos aparece una alerta persistente con un botón **"Renovar sesión"** de un clic que repite el login del navegador y refresca las credenciales guardadas.

Selecciona el perfil activo y la región desde los dropdowns en el encabezado del panel AWS.

---

## Resumen

**Resumen** es el primer elemento del menú de AWS y la vista con la que abre AWS. Muestra quién es el perfil activo y qué puede ver:

- **Cuenta**: ID de la cuenta (y alias si el perfil puede leerlo), con botón para copiar.
- **Identidad**: si el perfil es un usuario IAM, un rol, un permission set de SSO, un usuario federado o el usuario root, con su ARN. Las credenciales root muestran una advertencia.
- **Región**: la región del perfil y las regiones habilitadas en la cuenta.
- **Servicios**: una tarjeta por servicio con su cantidad de recursos: EC2 (running/detenidas), Lambda, ECS (clusters y servicios), EKS, ECR, VPC, API Gateway (REST/HTTP), S3, DynamoDB, RDS, EventBridge, Step Functions, CloudFront, Route 53, Cognito y Secrets Manager. Un servicio está **activo** si tiene al menos un recurso; los activos aparecen primero. S3, CloudFront y Route 53 son de toda la cuenta (marcados *Global*); el resto se cuenta en la región del perfil. Un `+` indica que hay más recursos de los que lee el resumen.

Cada servicio se lee por separado, en paralelo y con un tiempo máximo: si falta un permiso, solo esa tarjeta queda como *Sin permiso* (con la acción IAM cuando AWS la informa) y el resto carga igual. Al hacer clic en una tarjeta se abre la pestaña de ese servicio. Solo se hacen llamadas de lectura (List/Describe).

### Costos, actividad y servicios fuera de KUA

Debajo del resumen, el Resumen agrega (cargado en segundo plano para no demorar el resto):

- **Costos**: lo gastado en el mes, la proyección a fin de mes y el mes anterior, más los servicios que más cuestan (los que están fuera de KUA se marcan). Los datos vienen de Cost Explorer, que AWS cobra a USD 0.01 por consulta, así que KUA los guarda por perfil durante **12 horas** en disco (`~/.kuadashboard/aws-cost-cache.json`, o la carpeta de datos de la app de escritorio) y **Actualizar costos** fuerza una actualización (2 consultas). Sin acceso a Cost Explorer, KUA muestra el total estimado de la cuenta desde la métrica de facturación de CloudWatch (solo disponible con *Receive Billing Alerts* habilitado) y ofrece **Solicitar acceso**.
- **Actividad · últimas 24 h**: una tarjeta por servicio con datos, de toda la cuenta, con una línea de tendencia por hora:
  - **Lambda**: invocaciones, errores (y su tasa) y throttles.
  - **EC2**: CPU promedio de las instancias, pico y última hora.
  - **Load balancers**: requests, errores 5xx y latencia de los ALB, y tráfico de los NLB. Cuando es el propio load balancer el que devuelve los 5xx (suele indicar que no hay targets sanos), la tarjeta lo indica.
  - **EKS**: nodos, nodos con falla, CPU y memoria, si Container Insights está habilitado; si no, la tarjeta explica cómo obtenerlos.
  - **RDS**: CPU promedio y pico, conexiones y el menor espacio libre (se marca bajo 5 GB).
  - **DynamoDB**: unidades de lectura y escritura consumidas, requests con throttling, errores de sistema y latencia.
  - **Step Functions**: ejecuciones iniciadas, exitosas, fallidas o con timeout, y la duración promedio.
  - **EventBridge**: invocaciones de reglas, invocaciones fallidas y eventos coincidentes, del bus por defecto y de los buses propios.
  - **Glue**: ejecuciones de jobs iniciadas en las últimas 24 h (exitosas, fallidas, en curso, tiempo total) y los jobs que más fallaron.
  - **CloudFront**: requests, bytes descargados y tasas de error 4xx/5xx (leídos de us-east-1, donde CloudFront publica sus métricas).
  - **S3**: almacenamiento y cantidad de objetos de los buckets de la región del perfil (métrica diaria de CloudWatch).

  Las expresiones `SEARCH` de CloudWatch agregan todas las instancias o load balancers en una sola consulta, así que las tarjetas cuestan fracciones de centavo; las ejecuciones de Glue salen de la API de Glue.
- **Servicios fuera de KUA**: servicios con costo este mes o el anterior, recursos etiquetados (Resource Groups Tagging API, primeros 1.000 recursos) o cambios en las últimas 24 horas (solo eventos de escritura de CloudTrail, así que las lecturas de KUA no cuentan) que KUA todavía no gestiona, como Elastic Load Balancing, SQS, KMS o Kinesis. Los servicios que KUA solo usa indirectamente (CloudWatch, CloudWatch Logs, CloudFormation) aparecen al final como *Parcial en KUA*.

Cada fuente se lee por separado: si falta un permiso, solo se oculta esa fuente y se ofrece **Solicitar acceso**.

## Dashboards de CloudWatch

**Monitoreo → CloudWatch Dashboards** lista los dashboards de CloudWatch que ya existen en la cuenta (nombre, último cambio y tamaño), con búsqueda y orden. Para cada uno:

- **Abrir en la consola de AWS** abre el dashboard en la consola de CloudWatch (en la app de escritorio se abre en el navegador), en la región y partición del perfil.
- **Detalle** muestra un resumen de sus widgets en orden de lectura: tipo (métricas, logs, alarmas, texto…), título, qué muestra cada uno (métricas y namespaces, log groups de Logs Insights, alarmas), vista y región, más la definición JSON del dashboard para copiar.

KUA no vuelve a dibujar los widgets; el dashboard lo dibuja la consola de AWS. Requiere `cloudwatch:ListDashboards` y `cloudwatch:GetDashboard`; sin ellos, la vista ofrece **Solicitar acceso**.

## Solicitudes de acceso

Cuando AWS rechaza una solicitud, KUA explica qué falta en vez de mostrar solo el error crudo. El aviso de error de la vista de AWS (y cada tarjeta *Sin permiso* del Resumen) ofrece **Solicitar acceso**, que abre:

- **Los permisos que faltan**: la acción IAM que AWS informó como rechazada, más las otras acciones que usa la misma pantalla, para resolverlo con un solo permiso. Cuando AWS oculta la acción (por ejemplo, los mensajes de autorización codificados de EC2), KUA lista las acciones que usa esa pantalla.
- **Un mensaje para el administrador de AWS**: con el ARN de tu identidad, la cuenta, las acciones y el recurso, en inglés o español (independiente del idioma de la app), listo para copiar.
- **Una policy IAM sugerida**: la acción rechazada sobre el recurso informado y el resto de las acciones de la pantalla, lista para copiar.

La lista de acciones sale de `lib/awsIamCatalog.json`, generado a partir de los comandos del SDK de AWS de cada ruta de KUA (`npm run aws:iam-catalog`; un test falla si queda desactualizado). Solo cubre los servicios de AWS que soporta KUA. Revisa las policies sugeridas antes de aplicarlas y acota `Resource` a ARNs específicos cuando se pueda.

## Cómputo

### EC2 Instances

Navega todas las instancias EC2 con detalle completo y control del ciclo de vida:

- Instance ID, nombre (tag), tipo, IP pública/privada, availability zone, fecha de lanzamiento
- **Start** y **Stop** directamente desde la tabla
- **SSH** — abre una sesión SSH interactiva en el navegador (disponible cuando la instancia está `running`)
- **RDP** — abre un canvas de escritorio remoto Windows en el navegador (disponible para instancias Windows)
- **Tabs remotos persistentes** — oculta ventanas SSH/RDP sin cerrar el WebSocket y restáuralas desde la bandeja flotante de sesiones
- **Tags** — ver todos los tags del recurso
- **Config** — ver la configuración JSON completa de la instancia
- Columnas ordenables; búsqueda por nombre, ID, tipo o estado

### ECS (Elastic Container Service)

Visibilidad completa de los servicios ECS en todos los clusters:

- Nombre del servicio, task definition, cluster, estado (ACTIVE / DRAINING / INACTIVE)
- Conteos de tareas: desired, running y pending
- **Start** — escala el servicio a 1 tarea deseada
- **Stop** — escala el servicio a 0 tareas deseadas
- **Logs** — transmite logs de CloudWatch del servicio
- **CW Logs** — abre el explorador de CloudWatch Logs con ventana de tiempo configurable
- **Config** — ver configuración JSON completa del servicio

### EKS (Elastic Kubernetes Service)

Navega todos los clusters EKS:

- Nombre del cluster y endpoint de la API, región, versión de Kubernetes, estado, fecha de creación
- **Node groups** — managed node groups de cada cluster
- **EC2** — cantidad de instancias EC2 que corren como nodos (managed node groups, Karpenter y nodos self-managed, detectados por sus tags de EKS/Kubernetes)
- **Info** — infraestructura AWS del cluster, con el mismo diseño que los paneles Info de EC2 y Lambda:
  - **Overview** — ARN, versión y versión de plataforma, rol IAM, acceso al endpoint de la API (público/privado, CIDRs permitidos), OIDC issuer, CIDR de services, logs del control plane habilitados y tags
  - **Red** — VPC, cada subnet usada por el control plane, los node groups o los nodos (con CIDR, AZ, IPs libres y quién la usa) y los security groups del cluster, adicionales y de acceso remoto
  - **Node groups** — estado, tipo de capacidad, arquitectura, tipos de instancia, escalado (min/deseado/max), cantidad de EC2, AMI y release, subnets, Auto Scaling groups, launch template, rol de nodo y problemas de salud
  - **Instancias EC2** — cada instancia nodo con tipo, estado, origen (node group, `karpenter/<pool>` o `self-managed`), IP privada, AZ y spot/on-demand
  - **Add-ons** — add-ons administrados por EKS con versión, estado, rol IRSA y problemas de salud
  - Si falta un permiso (por ejemplo `ec2:DescribeInstances`), el resto de las secciones carga igual y un aviso indica qué no se pudo leer
- **Config** — inspeccionar ARN, endpoint, rol IAM y tags
- **Add to Dashboard** — ejecuta `aws eks update-kubeconfig` automáticamente para que el cluster aparezca en el panel de Kubernetes de inmediato

---

## Serverless

### Lambda Functions

Gestiona funciones Lambda con un modal de detalle completo — haz clic en el nombre de cualquier función para abrirlo.

- Nombre, descripción, runtime (Node.js / Python / Go / Java / etc.), memoria (MB), timeout (s), estado, última modificación
- **Invoke** — envía un payload JSON personalizado de forma síncrona e inspecciona la respuesta completa
- **Modal de detalle** (6 pestañas):
  - **Básico** — nombre, ARN, descripción, estado, versión, arquitectura, tipo de paquete, memoria, timeout, almacenamiento efímero, tamaño/hash del código y **Tags** (todo en una grid)
  - **Configuración** — variables de entorno (toggle reveal), layers, configuración VPC, tracing/DLQ/concurrencia, montajes EFS
  - **Logs** — visor de logs de CloudWatch en vivo con selector de rango de tiempo (15 min → 24 h) y refresco; si el log group no existe, muestra un botón **Crear Log Group** con retención configurable (7–365 días)
  - **Monitoreo** — sparklines de métricas CloudWatch: Invocaciones, Errores, Duración, Throttles, ConcurrentExecutions
  - **Aliases** — tabla de aliases y versiones publicadas
  - **Código** — árbol de archivos + visor de código con resaltado de sintaxis para funciones empaquetadas en ZIP

### API Gateway

Lista todas las APIs REST (v1) y HTTP/WebSocket (v2) en una tabla unificada:

- Nombre de la API, ID, tipo (REST / HTTP / WEBSOCKET), URL del endpoint, fecha de creación
- **Config** — ver stages, settings e historial de deployments
- **Routes** — abre el panel de integraciones con todas las rutas, métodos HTTP y targets de backend

---

## Almacenamiento

### S3 Browser

Navega el contenido de los buckets sin salir del dashboard:

- Nombre del bucket, región, fecha de creación, tags
- **Browse** — navega carpetas, ve tamaños de objetos, descarga archivos, previsualiza contenido de texto
- **Tags** — ver tags del bucket
- **Config** — ver versionado, cifrado, ACLs y configuración CORS
- **Test** — verifica la accesibilidad del endpoint y mide la latencia (ms) de cualquier bucket; el resultado se muestra inline por fila
- **+ Create Bucket** — crea un nuevo bucket S3 con nombre, región opcional y bloqueo de acceso público opcional

### DynamoDB

Inspecciona y gestiona tablas DynamoDB:

- Nombre de la tabla, esquema de clave (partición + sort), estado, modo de facturación (PAY_PER_REQUEST / PROVISIONED), conteo de ítems, tamaño en disco, fecha de creación
- **Browse** — escanea/consulta registros visualmente en el explorador de ítems
- **Info** — panel detallado: modo de facturación, throughput provisionado, esquema de clave, GSIs, LSIs, estado del stream, ARN
- **+ Create Table** — crea una nueva tabla con clave de partición, sort key opcional, modo de facturación y RCU/WCU

### ECR (Elastic Container Registry)

Gestiona repositorios de imágenes Docker:

- Nombre del repositorio, URI completa, mutabilidad de tags (MUTABLE / IMMUTABLE), scan-on-push, fecha de creación
- **Tags** — ver tags del recurso
- **Config** — ver lifecycle policies y configuración de escaneo
- **Images** — lista todas las imágenes del repositorio con digest, tags, fecha de push, tamaño y resultados de escaneo
- **Deploy to K8s** — genera manifiestos de Kubernetes desde cualquier tag de imagen y los aplica al cluster conectado:
  - Configura nombre de la app, namespace, réplicas, puerto, image pull secret y contexto `kubectl`
  - Opción **Crear Service** — añade opcionalmente un recurso `Service` (`ClusterIP`, `NodePort` o `LoadBalancer`) separado con `---`
  - Copiar YAML al portapapeles o aplicar con un clic (`kubectl apply --validate=false`)

---

## Redes

### VPC

Inspecciona Virtual Private Clouds:

- Nombre del VPC, ID, bloque CIDR, estado, número de subnets, indicador de VPC por defecto
- **Tags** — ver todos los tags del VPC
- **Config** — ver tablas de rutas, internet gateways y opciones DHCP
- **Info** — panel de análisis profundo (mismo diseño que los paneles Info de EC2 y Lambda, con botones para copiar IDs) con 6 pestañas internas:
  - **Overview** — tarjeta de info del VPC, conteos resumen de recursos (subnets, SGs, tablas de rutas, IGWs, NAT GWs) y todos los tags
  - **Subnets** — subnet ID, CIDR, availability zone, estado, auto-assign IP pública, IPs disponibles
  - **Security Groups** — tarjeta por grupo con nombre, descripción y tabla de reglas inbound (protocolo, rango de puertos, CIDR fuente)
  - **Route Tables** — tarjeta por tabla con todas las rutas (CIDR destino, target, origen, estado)
  - **Internet Gateways** — ID del gateway, estado, estado de adjunto
  - **NAT Gateways** — ID del gateway, subnet, IP pública/privada, estado, fecha de creación

### CloudFront

Gestiona distribuciones CDN:

- Nombre de dominio, estado (Deployed / InProgress), habilitada/deshabilitada, clase de precio, aliases personalizados, orígenes
- **Invalidate** — crea una invalidación de caché (`/*` o rutas específicas)
- **Stats** — ver métricas de transferencia de datos, conteo de solicitudes y tasa de error
- **Visit Site** — abre la URL de la distribución (o el alias primario) en una pestaña nueva
- **Config** — ver configuración completa de la distribución
- **+ Create from S3** — asistente para crear una nueva distribución desde un bucket S3

### Route 53

Explorador DNS de dos paneles:

- **Panel izquierdo** — zonas alojadas con conteo de registros e indicador público/privado
- **Panel derecho** — haz clic en una zona para cargar todos los registros (todas las páginas, incluidos los sets con política de routing y su Set ID): nombre, tipo, TTL, valor o target de alias
- **Búsqueda** — filtra por nombre, valor, target de alias o Set ID
- **Filtro por tipo** — muestra un solo tipo de registro (A, TXT, MX, CNAME...)
- **Seleccionar y exportar** — marca registros (la selección se mantiene aunque cambies la búsqueda o el filtro) y haz clic en **Export** para descargar un CSV. Sin selección, Export descarga los registros visibles

#### Diagnóstico DNS

La columna **DNS test** verifica si un registro está realmente publicado en Internet. Las pruebas se ejecutan desde la máquina donde corre KUA contra su resolver público, así que muestran lo que ve Internet y no solo lo guardado en Route 53. No usan credenciales de AWS.

Solo se ofrecen las pruebas que tienen sentido para cada tipo de registro:

| Registro | Prueba | Qué verifica |
|---|---|---|
| A / AAAA | Resolve + TCP | Que el nombre resuelve y luego abre una conexión TCP a la primera dirección en el puerto 443 y después 80 (2 s de timeout cada uno). No usa ping ni binarios del sistema |
| MX | Resolve | Servidores de correo, ordenados por prioridad |
| CNAME | Resolve | El destino del alias |
| NS | Resolve | Los name servers del nombre |
| TXT | Resolve | Todos los strings TXT (los valores partidos se unen) |
| TXT con `v=spf1` | SPF | Que exista exactamente un registro SPF y termine en un mecanismo `all` o `redirect=` |
| TXT en `<selector>._domainkey.<dominio>` | DKIM | Que haya un registro DKIM publicado con clave pública (`p=`) para ese selector |

Los resultados tienen tres estados:

- **OK** — el registro resuelve y pasa la verificación.
- **WARNING** — resuelve pero algo requiere atención: A/AAAA sin respuesta TCP en 443/80, SPF con `+all` o sin `all`, clave DKIM revocada (`p=` vacío), nombre TXT sin strings.
- **ERROR** — no resuelve (se muestra el código del resolver, por ejemplo `ENOTFOUND` o `ENODATA`), falta el SPF o está duplicado, o no se encuentra la clave DKIM.

Pasa el cursor sobre un resultado para ver los valores resueltos; haz clic para repetir la prueba. Los registros wildcard (`*.example.com`) y tipos como SOA, SRV o CAA no muestran prueba: prueba un subdominio concreto.

::: tip
Un registro que está **OK** en Route 53 pero da **ERROR** aquí normalmente indica que el registrador del dominio no delega a los name servers de la zona, o que la zona es privada.
:::

---

## Base de Datos & Analítica

### DocumentDB

Gestiona clusters de Amazon DocumentDB (compatible con MongoDB):

- ID del cluster, usuario master, estado, versión del motor, endpoint, puerto, indicadores de multi-AZ y cifrado de almacenamiento
- **Connect** — ver cadena de conexión y opciones TLS
- **Config** — ver configuración completa del cluster
- **Reset Pwd** — disparar un restablecimiento de contraseña del usuario master
- **+ New Cluster** — asistente de creación de cluster

### Glue

Monitorea y ejecuta jobs ETL:

- Nombre del job, tipo (glueetl / pythonshell / ray), versión de Glue, tipo y cantidad de workers, última modificación
- **Run** — dispara una ejecución on-demand del job
- **Runs** — ver historial de ejecuciones recientes con estado y duración
- **Info** — detalle del job: tipo, configuración de workers, ubicación del script, rol IAM, conexiones, argumentos por defecto, tags

### Athena

Explorador completo de pipelines de datos y editor SQL organizado en tres sub-pestañas:

**Workgroups**
- Nombre del workgroup, estado (ENABLED / DISABLED), versión del motor, ubicación S3 de salida, bytes escaneados, queries ejecutadas, descripción
- **Config** — configuración completa (motor, cifrado, salida, estadísticas, rol IAM, políticas)
- **Query** — salta directamente al editor SQL inline pre-cargado con el workgroup

**Data Sources**
- Árbol expandible catálogo → base de datos con tipo, descripción, parámetros y conteo de bases de datos
- **Info** — panel de detalle del catálogo
- **Editor** — abre el editor de consultas con el catálogo seleccionado
- **Tables** — lista de tablas inline para cualquier base de datos

**Query Editor**
- Diseño de panel dividido: árbol de datos en la barra lateral (catálogos → bases de datos → tablas) + editor SQL
- Ejecuta consultas y ve los resultados en una cuadrícula paginada
- Exporta resultados a CSV
- Panel de historial de consultas con las 20 ejecuciones más recientes

### Data Pipeline

Gestiona pipelines de datos programados:

- Nombre del pipeline, ID, estado (SCHEDULED / PAUSED / INACTIVE), última ejecución, próxima ejecución programada
- **Activate** — reanuda un pipeline pausado o inactivo
- **Pause** — suspende un pipeline programado en ejecución

---

## Seguridad & Identidad

### Cognito

Gestión completa de user pools con cuatro pestañas internas:

**Usuarios**
- Buscar/filtrar por email o username; paginado para pools grandes
- Username, email, estado (CONFIRMED / FORCE_CHANGE_PASSWORD), MFA, estado habilitado, fecha de creación
- **Detail** — ver todos los atributos del usuario
- **Reset pwd** — enviar email de restablecimiento de contraseña
- **Enable / Disable** — activar o desactivar la cuenta
- **+ Create User** — crear un nuevo usuario en el pool

**App Clients**
- Nombre del cliente, ID, flujos de autenticación, flujos OAuth, URLs de callback, validez de tokens, indicador de has-secret

**Identity Providers**
- IdPs federados: nombre, tipo (SAML / OIDC / Google / Facebook), issuer/metadata URL, mapeo de atributos

**Grupos**
- Todos los grupos del pool: nombre del grupo, descripción, precedencia, ARN del rol IAM, fecha de última modificación

**Pool Config**
- Política de contraseñas (longitud, requisitos de caracteres, validez de contraseña temporal)
- Atributos auto-verificados, fechas de creación/modificación
- Grid de atributos del schema (tipo de dato, requerido, mutable)
- Lambda triggers (pre-sign-up, post-confirmation, pre-token generation, etc.)

### Secrets Manager

Navega secretos de AWS Secrets Manager:

- Nombre del secreto con jerarquía de rutas completa, descripción, rotación habilitada, última modificación, ARN
- **Reveal** — obtiene y muestra el valor del secreto (enmascarado por defecto)
- **Config** — ver programación de rotación, política de recursos y regiones réplica

---

## Observabilidad

### EventBridge

Gestiona reglas event-driven en todos los event buses:

- Nombre de la regla, descripción, bus, estado (ENABLED / DISABLED), expresión de schedule o tipo de event pattern
- **Details** — inspeccionar targets de la regla (ARN de Lambda, URL de SQS, etc.) y JSON del event pattern completo
- **Logs** — transmitir logs del log group de CloudWatch asociado a la regla
- **Tags** — ver tags de la regla
- **Config** — ver configuración completa de la regla

### Step Functions

Visualiza e inspecciona state machines:

- Nombre de la state machine, tipo (STANDARD / EXPRESS), fecha de creación, ARN
- **Diagram** — renderiza el diagrama visual del workflow ASL inline usando la definición de la state machine
- **Tags** — ver tags
- **Config** — ver el JSON de definición ASL completo

---

## Características Comunes

Las 19 pestañas de servicios AWS comparten estas funcionalidades globales:

| Funcionalidad | Descripción |
|---|---|
| **Búsqueda en tiempo real** | Filtra filas escribiendo en la barra de búsqueda — los resultados se actualizan al instante |
| **Columnas ordenables** | Haz clic en cualquier encabezado de columna para alternar orden ascendente/descendente |
| **Selector de región** | Cambia la región AWS activa desde el dropdown del encabezado; los datos se recargan automáticamente |
| **Actualizar** | Haz clic en ↺ para recargar la pestaña actual desde las APIs de AWS |
| **Contador de resultados** | Muestra el estado de carga y el conteo final de registros en la barra de herramientas |
| **Chips de tags** | Los tags se muestran como chips inline en cada fila para referencia rápida |
