# ☁️ AWS

KUA cubre **22 servicios AWS** organizados por categoría en el sidebar. Selecciona un **perfil de credenciales** en el header (creado en el Env Manager con access key/secret y región); cada perfil puede apuntar a una cuenta y región distintas, con cambio en caliente.

---

## Cómputo

### EC2

![EC2](./images/aws-ec2.png)

Instancias con tipo, estado, IP pública/privada, AZ y fecha de lanzamiento.

- **Start / Stop / Reboot** por instancia.
- **SSH integrado** — con clave PEM (selector de archivo) o contraseña; sesión persistente en tab que sobrevive al cambio de vista. **RDP** para Windows con canvas integrado.
- Panel de detalle con 5 tabs: Overview, Monitoring (CloudWatch), Security Groups, Volumes y Console Output.
- Botones de copia ⧉ en Instance ID, AMI, IPs, DNS y Key Pair.

### Lambda

![Lambda](./images/aws-lambda.png)

Funciones con runtime, memoria, timeout y última modificación.

- Panel con 6 tabs: **Básico** (config + tags), **Configuración**, **Logs** (CloudWatch en vivo con rangos de 15 min a 24 h y creación de Log Group), **Monitoreo**, **Aliases** y **Código** (visor).
- **Invoke** con payload JSON personalizado y respuesta inline.

---

## Contenedores

### ECS

![ECS](./images/aws-ecs.png)

Clusters, servicios y tareas con estado deseado/corriendo, task definitions y logs.

### EKS

![EKS](./images/aws-eks.png)

Clusters de Kubernetes gestionados: versión, estado, endpoint. **Connect** importa el kubeconfig del cluster y cambia el contexto activo de KUA con un clic — pasas de ver el cluster en AWS a operarlo en la pestaña Kubernetes.

### ECR

![ECR](./images/aws-ecr.png)

Repositorios de imágenes con sus tags y digests. **Deploy to K8s**: genera el Deployment (y opcionalmente Service ClusterIP/NodePort/LoadBalancer) y lo aplica al cluster activo.

---

## Redes

### VPC

![VPC](./images/aws-vpc.png)

VPCs con CIDR, subnets, route tables y estado.

### API Gateway

![API Gateway](./images/aws-api-gateway.png)

APIs REST/HTTP con rutas, métodos e integraciones backend.

### CloudFront

![CloudFront](./images/aws-cloudfront.png)

Distribuciones CDN con dominio, origen, estado y aliases.

### Route 53

![Route 53](./images/aws-route-53.png)

Hosted zones y registros DNS por zona.

---

## Almacenamiento

### S3

![S3](./images/aws-s3.png)

Buckets con región y fecha. **Browser integrado**: navegación por carpetas virtuales, preview de texto/imágenes/PDF, metadata completa, descarga y test de acceso público.

---

## Bases de datos

### DynamoDB

![DynamoDB](./images/aws-dynamodb.png)

Tablas con billing mode, throughput, GSIs/LSIs y streams.

- **Create Table** con partition/sort key y modo de facturación.
- **Browse** con paginación: **edición de ítems** (editor JSON con validación en vivo), **eliminación** (extrae la clave primaria automáticamente) y **New Item** pre-llenado con los campos clave.

### RDS

![RDS](./images/aws-rds.png)

Instancias con motor, clase, almacenamiento y endpoint. Modal de detalle estilo consola AWS con tabs: Conectividad y seguridad, Supervisión y registros, Configuración, Mantenimiento y copias de seguridad, Migración y réplicas, Etiquetas. Acciones de **conexión** y **restablecer contraseña**.

---

## Analítica

### Glue

![Glue](./images/aws-glue.png)

Jobs ETL con tipo, workers, script location, rol IAM y argumentos.

### Athena

![Athena](./images/aws-athena.png)

Tres sub-pestañas: **Workgroups**, **Data Sources** (árbol catálogo → base de datos → tablas) y **Query Editor** con panel dividido, historial de consultas y exportación CSV.

### Data Pipeline

![Data Pipeline](./images/aws-data-pipeline.png)

Pipelines de datos con estado y programación.

---

## Integración

### EventBridge

![EventBridge](./images/aws-eventbridge.png)

Reglas de eventos con patrón/schedule, targets, logs y métricas.

### Step Functions

![Step Functions](./images/aws-step-functions.png)

State machines con **visualización de diagrama** del workflow, ejecución con payload personalizado y columna de ejecuciones en vivo (activas ▶, fallidas ✗, timeout ⏱). Modal Info con tabs: Detalles, Diagrama, Ejecuciones, Eventos y Versiones (con definición ASL por versión).

### Amazon Lex

![Amazon Lex](./images/aws-amazon-lex.png)

Bots conversacionales en layout master-detail: lista de bots a la izquierda; tabs **Intents, Aliases, Slot Types, Chat (prueba conversacional en vivo), Logs, Missed (utterances no reconocidas), Metrics y Test Set** a la derecha. Datos cargados bajo demanda con caché por bot.

---

## AI

### Bedrock

![Bedrock](./images/aws-bedrock.png)

Modelos fundacionales disponibles y acceso por perfil.

### AgentCore CFN

![AgentCore](./images/aws-agentcore-cfn.png)

Stacks CloudFormation de agentes AI con estado y recursos.

---

## Seguridad

### Cognito

![Cognito](./images/aws-cognito.png)

User Pools en master-detail: usuarios con **búsqueda de texto libre**, edición de atributos, gestión de grupos por usuario (asignar/remover), **control de MFA** (toggle, método preferido SMS/TOTP) y creación de grupos con descripción.

### Secrets Manager

![Secrets Manager](./images/aws-secrets-manager.png)

Secretos con descripción, rotación y fechas. Vista de valores con permisos adecuados.
