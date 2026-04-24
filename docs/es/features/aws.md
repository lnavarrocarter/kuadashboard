# Integración AWS

KuaDashboard proporciona un panel completo de gestión de AWS accesible desde la barra lateral en **Cloud > AWS**. Ofrece una vista unificada de **19 servicios de AWS** sin salir del dashboard.

> **Novedades en v1.6.0:** tab Logs en Lambda con visor de CloudWatch y opción de crear log group; corrección del YAML en ECR Deploy to K8s + opción de crear Service; corrección de límites maxResults en Lex y Athena.

![KuaDashboard — vista general](/screenshots/dashboard-main.png)

## Autenticación

Las credenciales de AWS pueden configurarse de múltiples formas:

| Método | Descripción |
|---|---|
| **Env Manager** | Perfiles nombrados con `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_DEFAULT_REGION` |
| **AWS CLI** | Lee `~/.aws/credentials` y `~/.aws/config` automáticamente |
| **Perfiles locales** | Selecciona cualquier perfil nombrado de tu `~/.aws/credentials` |
| **Variables de entorno** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| **Roles IAM** | Al ejecutar en infraestructura AWS (EC2, tarea ECS, Lambda, etc.) |

Selecciona el perfil activo y la región desde los dropdowns en el encabezado del panel AWS.

---

## Cómputo

### EC2 Instances

Navega todas las instancias EC2 con detalle completo y control del ciclo de vida:

- Instance ID, nombre (tag), tipo, IP pública/privada, availability zone, fecha de lanzamiento
- **Start** y **Stop** directamente desde la tabla
- **SSH** — abre una sesión SSH interactiva en el navegador (disponible cuando la instancia está `running`)
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

- Nombre del cluster, región, versión de Kubernetes, estado, fecha de creación
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
- **Details** — panel de análisis profundo con 6 pestañas internas:
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
- **Panel derecho** — haz clic en una zona para cargar todos los registros: nombre, tipo, TTL, valor o target de alias

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
