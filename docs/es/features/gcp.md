# Integración GCP

KuaDashboard ofrece una gestión completa de Google Cloud Platform accesible desde la barra lateral en **Cloud > Google Cloud**. Los servicios se agrupan por categoría en el sidebar izquierdo.

## Cómputo

### Cloud Run
- Listar todos los servicios Cloud Run con estado, región, URL y revisión
- **Iniciar / Detener** servicios (ajusta el número mínimo de instancias)
- Enlace directo a Cloud Console

### Cloud Run Jobs
- Listar todos los Cloud Run Jobs con estado y resultado de la última ejecución
- **Ejecutar** un job bajo demanda (lanza una ejecución)
- **Ver ejecuciones** — modal de detalle con historial de ejecuciones, estado y marcas de tiempo

### GKE (Google Kubernetes Engine)
- Listar clústeres GKE con versión, ubicación, número de nodos y estado
- Copiar el comando de conexión `kubectl` al portapapeles

### Compute Engine VMs
- Listar todas las instancias VM con zona, tipo de máquina, IP externa y estado
- **Iniciar / Detener** instancias VM

## Base de datos

### Cloud SQL
- Listar instancias Cloud SQL con versión de base de datos, tier y estado
- **Iniciar / Detener** instancias (activar / desactivar)

### Cloud Spanner
- Listar instancias Spanner con recuento de nodos y unidades de procesamiento
- Desglose en **bases de datos** por instancia
- **Editor de consultas SQL** — ejecuta consultas de solo lectura contra cualquier base de datos Spanner

### Firestore
- Listar bases de datos Firestore (incluyendo la base de datos `(default)`)
- Desglose en **colecciones** por base de datos
- Explorar **documentos** dentro de cada colección

### Memorystore (Redis)
- Listar instancias Redis de Memorystore con versión, tier, capacidad y estado

## Almacenamiento

### Cloud Storage
- Explorar todos los buckets de GCS
- Navegador de archivos con desglose por bucket (navegación por prefijo)
- **Vista previa** de objetos texto/JSON/YAML directamente en la interfaz
- **Descargar** objetos directamente a tu máquina

### Artifact Registry
- Listar todos los repositorios de Artifact Registry con formato y ubicación
- Desglose en **paquetes** (imágenes Docker, artefactos Maven, paquetes npm, etc.)

## Serverless

### Cloud Functions
- Listar todas las Cloud Functions (1ª y 2ª gen) con runtime, trigger y estado
- **Invocar** una función con un cuerpo JSON personalizado
- **Ver logs** — últimas 50 entradas de log en tiempo real

## Mensajería

### Pub/Sub Tópicos
- Listar todos los tópicos de Pub/Sub

### Pub/Sub Suscripciones
- Listar todas las suscripciones con tipo (push/pull), tópico, filtro, ACK deadline y período de retención

## Seguridad

### Secret Manager
- Listar todos los secretos con fecha de creación y último acceso
- **Vista previa** del valor de la última versión (primeros 500 caracteres)
- **Importar al Env Manager** — guardar el valor del secreto como variable de entorno

### Cloud KMS
- Listar key rings en todas las ubicaciones disponibles
- Desglose en **claves criptográficas** por key ring con propósito, algoritmo y programación de rotación

## Analítica

### BigQuery
- Listar todos los datasets de BigQuery
- Desglose en **tablas** por dataset (esquema, número de filas, tamaño)
- **Editor de consultas SQL** — ejecuta consultas con polling de jobs y resultados paginados

## Flujos de trabajo

### Cloud Workflows
- Listar todos los Cloud Workflows con estado y última actualización
- Ver **ejecuciones** (últimas 20) con estado y duración
- **Ver definición** — visualiza el YAML/JSON del workflow

## Red

### Cloud DNS
- Listar todas las zonas DNS administradas con nombre DNS y visibilidad
- Desglose en **registros DNS** por zona (tipo, TTL, valores)

### VPC Networks
- Listar todas las redes VPC con modo de subred automático y modo de enrutamiento
- Desglose en **subnets** por red con CIDR, gateway, región, Private Google Access y estado de Flow Logs

## Asíncrono / Programación

### Cloud Tasks
- Listar todas las colas de Cloud Tasks con estado y límites de tasa
- Ver **tareas** en una cola (paginado)

### Cloud Scheduler
- Listar todos los jobs de Cloud Scheduler con horario, tipo de destino y estado
- **Ejecutar** un job de inmediato
- **Pausar / Reanudar** un job

## DevOps

### Cloud Build
- Listar las builds recientes de Cloud Build con trigger, rama, estado y duración (paginado)
- **Ver logs** — log completo de build visualizado inline

## Observabilidad

### Cloud Monitoring
- **Políticas de alerta** — lista todas las alert policies con estado habilitado/deshabilitado y número de condiciones
- **Uptime checks** — lista todas las configuraciones de verificación de disponibilidad con tipo, recurso y período

### Cloud Logging
- **Panel de consulta interactivo** — introduce un filtro avanzado, elige un rango de horas (1–72) y ejecuta
- Los resultados muestran timestamp, severidad (código de color), tipo de recurso, nombre del log y payload de texto

## IAM

### Cuentas de servicio IAM
- Listar todas las cuentas de servicio con nombre, email y estado (paginado)
- Desglose en **claves** por cuenta de servicio con ID de clave, tipo y fechas de creación/expiración


## Autenticación

Las credenciales de GCP pueden configurarse de varias formas:

### Perfiles Almacenados (Env Manager)
Crea un perfil GCP en el Env Manager con un JSON de service account key. El perfil se almacena de forma segura y puede seleccionarse desde el dropdown del panel GCP.

### Configuraciones gcloud CLI
Si `gcloud` está instalado, KuaDashboard detecta automáticamente todas las configuraciones de `gcloud` y las lista en el dropdown de perfiles. Esto usa Application Default Credentials.

### Selección de Perfil
El dropdown del panel GCP muestra dos grupos:
- **Perfiles almacenados** — Creados en el Env Manager
- **Configuraciones gcloud** — Auto-detectadas desde el CLI `gcloud` local

## Interfaz por Pestañas

El panel GCP usa una interfaz de pestañas:

| Pestaña | Contenido |
|---------|-----------|
| Cloud Run | Tabla de servicios Cloud Run |
| GKE | Clústeres de Kubernetes Engine |
| VMs Compute | Instancias de Compute Engine |

Cada pestaña carga datos independientemente y muestra un badge con el conteo. Los errores (como APIs deshabilitadas) muestran un banner inline con un enlace directo para habilitar la API en Cloud Console.
