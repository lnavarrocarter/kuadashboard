# Integración GCP

KuaDashboard proporciona gestión de Google Cloud Platform accesible desde la barra lateral en **Cloud > Google Cloud**.

## Servicios Soportados

### Cloud Run
- Listar todos los servicios Cloud Run
- Ver estado del servicio, región y configuración de escalado
- **Iniciar** / **Detener** servicios (ajustar instancias mínimas)
- Enlace directo a Cloud Console

### GKE (Google Kubernetes Engine)
- Listar clústeres GKE
- Ver versión del clúster, ubicación, número de nodos y estado

### Compute Engine VMs
- Listar todas las instancias de VM
- Ver zona, tipo de máquina, IP externa y estado
- **Iniciar** / **Detener** instancias VM

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
