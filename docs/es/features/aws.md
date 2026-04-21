# Integración AWS

KuaDashboard proporciona un panel completo de gestión de AWS accesible desde la barra lateral en **Cloud > AWS**.

## Servicios Soportados

### Lambda Functions
- Listar todas las funciones Lambda con runtime, memoria e información de timeout
- Ver configuración de la función
- Invocar funciones con payloads personalizados

### ECS (Elastic Container Service)
- Navegar clústeres ECS
- Listar servicios y tareas por clúster
- Ver definiciones de tareas y estado

### EKS (Elastic Kubernetes Service)
- Listar clústeres EKS
- Ver detalles del clúster (versión, estado, endpoint)

### EC2 Instances
- Listar todas las instancias entre regiones
- Iniciar y detener instancias
- Ver detalles de la instancia (tipo, IP, estado)

### Explorador S3
- Listar y navegar buckets S3
- Navegar contenidos del bucket (carpetas y archivos)
- Descargar objetos
- Ver contenido de archivos de texto

### API Gateway
- Listar APIs REST y HTTP
- Ver rutas e integraciones
- Inspeccionar configuraciones de stage

### EventBridge
- Listar buses de eventos y reglas
- Ver targets de reglas
- Navegar patrones de eventos

### Step Functions
- Listar state machines
- Renderizado visual de diagramas de workflows
- Ver historial de ejecuciones

## Autenticación

Las credenciales de AWS pueden configurarse de múltiples formas:

1. **Env Manager** — Almacenar perfiles con access keys
2. **AWS CLI** — Usa `~/.aws/credentials` y `~/.aws/config`
3. **Variables de entorno** — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
4. **Roles IAM** — Al ejecutar en infraestructura AWS

Selecciona tu perfil activo desde el dropdown en el encabezado del panel AWS.
