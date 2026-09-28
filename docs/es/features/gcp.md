---
title: Dashboard de Gestión de Google Cloud GCP
description: Gestiona Cloud Run, GKE, Cloud SQL, Storage, BigQuery, Pub/Sub y más servicios de Google Cloud con KUA.
---

# Integración GCP

KuaDashboard ofrece una gestión completa de Google Cloud Platform accesible desde la barra lateral en **Cloud > Google Cloud**. Los servicios se agrupan por categoría en el sidebar izquierdo.

## Cómputo

### Cloud Run
- Tabla de servicios con estado (incluye despliegues fallidos), imagen, CPU/memoria, instancias mín–máx, ingress, revisión activa (marca si hay una revisión más nueva que aún no recibe tráfico) y última actualización
- **Start / Stop / Eliminar** en cada fila; **＋ Nuevo servicio** para crear (ver [acciones seguras](#crear-iniciar-y-eliminar-recursos-de-forma-segura))
- **Start / Stop** ajusta el número mínimo de instancias
- Enlace directo a Cloud Console

### Cloud Run Jobs
- Listar todos los Cloud Run Jobs con estado y resultado de la última ejecución
- **Ejecutar** un job bajo demanda (lanza una ejecución)
- **Ver ejecuciones** — modal de detalle con historial de ejecuciones, estado y marcas de tiempo

### GKE (Google Kubernetes Engine)
- Listar clústeres GKE con versión, ubicación, número de nodos y estado
- Copiar el comando de conexión `kubectl` al portapapeles

### Compute Engine VMs
- Tabla de VMs con estado, tipo de máquina (marca Spot/Preemptible), IP interna y externa, red/subred, cantidad y tamaño de discos, protección contra eliminación y fecha de creación
- **Start / Stop / Eliminar** en cada fila; **＋ Nueva VM** para crear (ver [acciones seguras](#crear-iniciar-y-eliminar-recursos-de-forma-segura))

## Base de datos

### Cloud SQL
- Tabla de instancias con un estado claro — **RUNNING**, **STOPPED** (Cloud SQL informa RUNNABLE aunque esté detenida, así que KUA lo deriva de la política de activación), PENDING_CREATE, MAINTENANCE… — además de motor, tier/edición, zonal o HA, almacenamiento, backups, IP pública/privada y protección contra eliminación
- **Start / Stop / Eliminar** en cada fila, habilitados según el estado; **＋ Nueva instancia** para crear (ver [acciones seguras](#crear-iniciar-y-eliminar-recursos-de-forma-segura))

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

## Crear, iniciar y eliminar recursos de forma segura

Cloud Run, las VMs de Compute Engine y Cloud SQL muestran sus recursos en una tabla con las acciones en la misma fila (**Start**, **Stop**, **🗑 Eliminar**), y un botón **＋ Nuevo** para crear. Al hacer clic en una fila se abre su detalle debajo de la tabla. Toda acción que genera costos o no se puede deshacer pide confirmación antes:

| Acción | Qué debes confirmar |
|---|---|
| **Start** | Muestra el costo mensual estimado de mantenerlo encendido y exige marcar *"Entiendo que esta acción genera costos"*. En Cloud Run, Start fija min instances = 1, que factura 24/7. |
| **Stop** | Indica qué sigue facturando mientras está detenido (discos, IPs estáticas, almacenamiento de SQL) y los efectos secundarios (cambio de IP efímera, arranque en frío). |
| **Eliminar** | Irreversible: debes escribir el nombre del recurso. El diálogo indica qué se pierde (revisiones y URL de Cloud Run; discos con auto-delete de la VM — los discos sin auto-delete se conservan y siguen facturando; todas las bases, usuarios y backups automáticos de Cloud SQL). Los recursos con **protección contra eliminación** no se pueden eliminar desde KUA: desactívala primero en la consola de Google Cloud. |
| **Crear** | El formulario muestra el costo estimado en vivo. Antes de crear, una pantalla de revisión resume la configuración, destaca las opciones de riesgo (servicio Cloud Run público, VM con IP pública, SQL sin backups o sin protección contra eliminación) y exige escribir el nombre y aceptar el costo. Las estimaciones de **$100/mes o más** requieren una segunda confirmación explícita de costo alto. |

Valores seguros por defecto al crear: los servicios Cloud Run quedan **privados** salvo que permitas explícitamente el acceso sin autenticación; las instancias Cloud SQL se crean con **backups automáticos** y **protección contra eliminación**; los recursos llevan la etiqueta `created-by=kua`.

El backend aplica las mismas reglas: las solicitudes de creación y eliminación sin el nombre escrito o sin las confirmaciones requeridas se rechazan, así que no se pueden saltar llamando a la API directamente. Cada creación y eliminación queda en el registro de auditoría con su costo mensual estimado.

::: warning Las estimaciones de costo son aproximadas
Usan precios de lista on-demand de us-central1 y no incluyen descuentos por uso sostenido o comprometido, free tier, egress de red, licencias ni impuestos. Tómalas como advertencia, no como cotización; revisa la [calculadora de precios de Google Cloud](https://cloud.google.com/products/calculator) para cifras exactas.
:::

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
