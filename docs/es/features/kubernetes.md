# Funcionalidades de Kubernetes

![KuaDashboard — Panel de Kubernetes](/screenshots/dashboard-main.png)

## Explorador de Recursos

Navega todos los recursos principales de Kubernetes con tablas ordenables y filtrables:

- **Workloads**: Pods, Deployments, StatefulSets, DaemonSets
- **Network**: Services, Ingresses
- **Config**: ConfigMaps, Secrets (valores ocultos por defecto)
- **Storage**: PersistentVolumeClaims
- **Cluster**: Nodes, Events

Cada tabla de recursos muestra los campos clave (nombre, namespace, estado, antigüedad) y proporciona acciones contextuales.

## Streaming de Logs en Vivo

Transmite logs de pods en tiempo real vía WebSocket:

- Selecciona contenedores específicos en pods multi-contenedor
- Interfaz multi-tab — transmite logs de múltiples pods simultáneamente
- Búsqueda dentro de la salida de logs
- Auto-scroll con anulación manual

## Shell Interactiva (Exec)

Abre una sesión de terminal directamente en cualquier pod en ejecución:

- Soporte completo de PTY vía WebSocket
- Selección de contenedor para pods multi-contenedor
- Los atajos de teclado funcionan como se espera

## Visor y Editor YAML

Visualiza y edita el manifiesto YAML completo de cualquier recurso:

- Visualización YAML con resaltado de sintaxis
- Edita en el lugar y **Aplica** los cambios al clúster
- Los valores de Secrets aparecen como `[REDACTED]` por seguridad

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
