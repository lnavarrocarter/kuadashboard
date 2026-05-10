# Funcionalidades de Kubernetes

![KuaDashboard — Panel de Kubernetes](/screenshots/dashboard-main.png)

## Explorador de Recursos

Navega todos los recursos principales de Kubernetes con tablas ordenables y filtrables:

- **Workloads**: Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs
- **Network**: Services, Ingresses, IngressClasses, Endpoints, EndpointSlices, NetworkPolicies
- **Config**: ConfigMaps, Secrets (valores ocultos por defecto)
- **Storage**: PersistentVolumeClaims, PersistentVolumes, StorageClasses
- **Policy & Scheduling**: ResourceQuotas, LimitRanges, HPAs, PDBs, Leases, PriorityClasses, RuntimeClasses
- **Admission & Cluster**: MutatingWebhookConfigurations, ValidatingWebhookConfigurations, Namespaces, Nodes, Events

Cada tabla de recursos muestra los campos clave (nombre, namespace, estado, antiguedad) y proporciona acciones contextuales. Las tablas soportan seleccion multiple para eliminacion masiva cuando Kubernetes permite borrar ese tipo de recurso.

La columna `Age` se muestra como duracion legible y ordena internamente por tiempo real transcurrido, por lo que valores como `30sec`, `2min`, `23hrs 10min` y `1day 3hrs 10min` se ordenan bien en ambas direcciones.

Al seleccionar una fila se abre un panel lateral ajustable con resumen específico por recurso: labels, contenedores, red, almacenamiento, eventos o scheduling según el tipo seleccionado.

## Auto-refresh

KuaDashboard puede refrescar automáticamente la vista activa de Kubernetes sin cambiar tu namespace, tipo de recurso o panel de detalle seleccionado.

El auto-refresh también respeta las vistas AWS, GCP y Helm, manteniendo actualizada la superficie operativa visible sin recargas manuales.

## Streaming de Logs en Vivo

Transmite logs de pods y workloads en tiempo real vía WebSocket:

- Selecciona contenedores específicos en pods multi-contenedor
- Transmite Pods directamente o resuelve Deployments, StatefulSets y DaemonSets a sus Pods activos
- Interfaz multi-tab — transmite logs de múltiples pods o workloads simultáneamente
- Búsqueda dentro de la salida de logs y filtro por fecha/hora serializada
- Descarga de la vista filtrada actual como archivo `.log`
- Limpieza ANSI/VT y buffer de fragmentos para logs de frameworks serializados correctamente
- Auto-scroll con anulación manual

## Shell Interactiva (Exec)

Abre una sesión de terminal directamente en cualquier pod en ejecución:

- Soporte completo de PTY vía WebSocket
- Selección de contenedor para pods multi-contenedor
- Los atajos de teclado funcionan como se espera

## Visor y Editor YAML

Visualiza y edita el manifiesto YAML completo de cualquier recurso:

- Búsqueda con acción de confirmación y navegación anterior/siguiente
- Lint/validación antes de guardar, con diagnóstico de línea y columna
- Botón de guardado y soporte de atajos de teclado
- Indicador de línea, columna, total de líneas y ruta de sección actual
- Sugerencias de autocompletado con `Ctrl+Space`
- Edita en el lugar y guarda los cambios al clúster
- Los valores de Secrets aparecen como `[REDACTED]` por seguridad

## Edicion de Config, Secrets y Environments

ConfigMaps y Secrets incluyen un editor clave/valor enfocado para cambios comunes sin editar manualmente todo el manifiesto. Los valores de Secrets permanecen protegidos en las vistas YAML y aun asi pueden editarse de forma controlada desde la pestana de datos.

Los paneles de workloads muestran las variables de entorno de cada contenedor, facilitando inspeccion y actualizacion de envs sin salir del contexto del recurso.

## Panel de Detalle de Recursos

Haz clic en cualquier fila de recurso Kubernetes para abrir un panel lateral derecho:

- **Resumen** — campos específicos para Pods, workloads, Services, Ingresses, Secrets, PVCs, Nodes y Events
- **YAML** — árbol estructurado del manifiesto vivo
- **Metricas** — tarjetas CPU y memoria para Pods, workloads y Nodes usando `metrics.k8s.io` cuando esta disponible
- **Fallback Prometheus** — detecta servicios Prometheus y consulta metricas mediante el proxy del API server de Kubernetes cuando Metrics Server no esta disponible
- **Eventos** — vista de eventos relacionados y notificaciones para diagnosticar scheduling, image pull, salud y ciclo de vida
- **Layout ajustable** — arrastra el divisor para cambiar el ancho del panel

## Helm y Metrics Server

La vista Helm puede buscar charts en repositorios configurados, instalarlos en el cluster activo y listar releases instalados. Las instalaciones muestran salida y estado del release para que los procesos largos sean visibles.

Al instalar `metrics-server`, KuaDashboard ofrece un preset de compatibilidad para clusters locales o self-signed:

```yaml
args:
	- --kubelet-insecure-tls
	- --kubelet-preferred-address-types=InternalIP,ExternalIP,Hostname
apiService:
	insecureSkipTLSVerify: true
```

## Escalado

Escala Deployments y StatefulSets con un diálogo simple:

- Muestra el número actual de réplicas
- Introduce las réplicas deseadas
- Aplicación inmediata con feedback de estado

## Gestión de Nodes

Operaciones avanzadas de nodos:

- **Cordon** — Marcar nodo como no programable
- **Uncordon** — Restaurar programación
- **Drain** — Desalojar todos los pods de forma segura (cordon + evict)

## Cambio de Contexto y Namespace

- **Multi-contexto** — Cambia entre contextos de Kubernetes desde el dropdown del encabezado
- **Multi-namespace** — Selector global de namespace (incluyendo "Todos los namespaces")
- **Import kubeconfig** — Agrega clusters desde YAML pegado, selector de archivo desktop o registro manual de una ruta kubeconfig
- **Eliminar contexto** — Remueve contextos no deseados
