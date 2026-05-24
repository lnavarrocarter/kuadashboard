# Changelog

## v1.10.0 (Mayo 2026)

### Agente IA

- Integración de agente IA local usando Ollama como runtime LLM, con soporte opcional para OpenAI y Anthropic Claude vía API key.
- Cuatro tipos de agente: DevOps, Bootstrap, Code Review y General, cada uno con system prompt especializado e inyección de contexto de recursos activos.
- Panel de chat global slideout con streaming SSE en tiempo real, historial de mensajes y botones `[▶ Ejecutar]` que inyectan comandos directamente en la pestaña de terminal activa.
- Gestión de modelos Ollama: descarga modelos con barra de progreso, estado del proceso (activo/detenido/no instalado) y auto-start de Ollama desde Electron.
- Agente Bootstrap: importa repositorios de GitHub o carpetas locales, detecta el stack tecnológico y genera Dockerfile, docker-compose, manifests de Kubernetes y configs de CI.
- Botón ✨ en el terminal abre el agente IA precargado con el contexto del tab activo (tipo de tab, últimos 5 comandos, último output).
- Perfiles OpenAI y Anthropic en el Gestor de Credenciales con campos de API key y base URL opcional.

## v1.9.0 (Mayo 2026)

### Vercel

- Integración completa con Vercel mediante autenticación OAuth — conecta tu cuenta directamente desde el modal de perfil.
- Vista de proyectos con estado de deployment, framework, región y acceso directo a la URL en vivo.
- Detalle de deployments con pestañas de Actividad, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config y Checks.

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
