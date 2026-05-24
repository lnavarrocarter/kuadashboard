/**
 * composables/useChangelog.js
 * Single source of truth for the application changelog.
 * Used by both HelpModal (full history) and WelcomeModal (latest release only).
 */

export const CHANGELOG_VERSION = '1.10.0'

export const CHANGELOG = [
  {
    version: '1.10.0',
    date: 'Mayo 2026',
    items: [
      { type: 'new',    text: 'Agente IA local — integración con Ollama como runtime LLM con soporte opcional para OpenAI y Anthropic Claude vía API key' },
      { type: 'new',    text: 'Agente IA — 4 tipos de agente: DevOps, Bootstrap, Code Review y General, cada uno con system prompt especializado y contexto de recursos activos' },
      { type: 'new',    text: 'Chat panel global — panel slideout lateral con streaming SSE, historial de mensajes y botones [▶ Ejecutar] para inyectar comandos al terminal activo' },
      { type: 'new',    text: 'Gestión de modelos Ollama — descarga de modelos con progress bar, estado del proceso Ollama (running/stopped/not installed) y auto-start desde Electron' },
      { type: 'new',    text: 'Bootstrap de proyectos — importación de repos GitHub o carpetas locales para que el agente detecte el stack y genere Dockerfile, docker-compose, manifests K8s y CI configs' },
      { type: 'new',    text: 'Terminal Ask AI — botón ✨ en el panel de terminal para abrir el agente con contexto del tab activo (tipo, últimos 5 comandos, último output)' },
      { type: 'new',    text: 'Perfiles OpenAI y Anthropic — soporte de API keys para ambos proveedores en el Gestor de Credenciales' },
    ],
  },
  {
    version: '1.9.0',
    date: 'Mayo 2026',
    items: [
      { type: 'new',    text: 'Vercel — integración completa: autenticación OAuth, proyectos, deployments, actividad, DNS Records, Aliases, Cron Jobs, Webhooks, Edge Config y Checks' },
    ],
  },
  {
    version: '1.8.0',
    date: 'Mayo 2026',
    items: [
      { type: 'new',    text: 'Kubernetes — selección múltiple en tablas de recursos, eliminación masiva y ordenamiento de Age por duración real con formato días/horas/minutos/segundos' },
      { type: 'new',    text: 'Kubernetes — menú ampliado con más recursos de workloads, networking, storage, config, policy, RBAC, scheduling, admission y cluster' },
      { type: 'new',    text: 'ConfigMaps y Secrets — editor de datos en formato clave/valor, mapeo sencillo y vista de variables de entorno asociadas' },
      { type: 'new',    text: 'Workloads — edición de variables de entorno para contenedores desde el panel de detalle' },
      { type: 'new',    text: 'Helm — búsqueda de charts, instalación directa en el cluster, gestión de releases instalados y estado/output de instalación visible' },
      { type: 'new',    text: 'Helm — preset de compatibilidad para metrics-server con flags de kubelet TLS y dirección preferida para clusters locales o self-signed' },
      { type: 'new',    text: 'Observabilidad — métricas para Pods, workloads y Nodes con metrics.k8s.io y fallback vía Prometheus detectado en Services del cluster' },
      { type: 'new',    text: 'Eventos — visor de eventos y notificaciones relacionadas para recursos y Nodes desde el panel de detalle' },
      { type: 'new',    text: 'Kubeconfig — importación desde YAML pegado, archivo local mediante Electron y registro manual de rutas existentes' },
      { type: 'fix',    text: 'Port Forwarding — túneles más estables para Services y Pods con resolución de pod objetivo, estado persistente y reconexión' },
    ],
  },
  {
    version: '1.7.0',
    date: 'Mayo 2026',
    items: [
      { type: 'new',    text: 'Kubernetes — auto-refresh por vista activa: Kubernetes, AWS, GCP y Helm actualizan sus recursos sin perder el contexto de trabajo' },
      { type: 'new',    text: 'Kubernetes — panel lateral de detalle por recurso con resumen especializado, YAML estructurado, secciones por tipo y ancho ajustable' },
      { type: 'new',    text: 'Kubernetes — métricas visuales para Pods usando metrics.k8s.io y detección de Prometheus, con acceso directo a Helm cuando no hay observabilidad instalada' },
      { type: 'new',    text: 'Kubernetes Logs — streaming en tiempo real para Pods, Deployments, StatefulSets y DaemonSets con resolución de pods por selector' },
      { type: 'new',    text: 'Terminal Logs — buscador, filtros por fecha serializada, descarga de logs y conteo de líneas filtradas' },
      { type: 'better', text: 'Terminal Logs — limpieza de secuencias ANSI/VT y buffer de fragmentos para serializar correctamente logs de frameworks como NestJS' },
      { type: 'new',    text: 'YAML Editor — búsqueda por confirmación, botón Guardar, validación/lint, estado de línea/columna/total de líneas, ruta de sección y autocompletado con Ctrl+Space' },
      { type: 'new',    text: 'AWS EC2 — sesiones SSH/RDP persistentes en tabs: ocultar una consola ya no corta la conexión y se puede reabrir desde la bandeja de sesiones' },
      { type: 'fix',    text: 'AWS — resuelta advertencia de lint vue/no-v-for-template-key en la vista Athena' },
    ],
  },
  {
    version: '1.6.2',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'AWS EC2 Info — botones de copia ⧉ en campos clave: Instance ID, AMI, IP Pública/Privada, DNS Público/Privado, Key Pair y Perfil IAM' },
      { type: 'new',    text: 'AWS Lambda Info — botones de copia ⧉ en campos clave: ARN, SHA256, VPC ID, DLQ ARN y KMS Key ARN' },
      { type: 'better', text: 'UX — el botón de copia aparece al hacer hover y confirma visualmente con ✓ durante 1.5 s; sin dependencias externas (Clipboard API nativa)' },
    ],
  },
  {
    version: '1.6.1',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'AWS RDS — nuevo panel por instancia con acciones Info, Configuración, Conexión y Restablecer contraseña' },
      { type: 'new',    text: 'AWS RDS — modal de detalle rediseñado con pestañas estilo consola AWS: Conectividad y seguridad, Supervisión y registros, Configuración, Mantenimiento y copias de seguridad, Migración y réplicas, y Etiquetas' },
      { type: 'better', text: 'AWS RDS — traducción completa al español de textos, botones y mensajes de los modales de Info, Conexión y Restablecimiento de contraseña' },
      { type: 'better', text: 'AWS Database — unificación de navegación y vista para trabajar bajo RDS, eliminando la sección residual de DocumentDB en la interfaz' },
      { type: 'better', text: 'Documentación — guía de permisos mínimos IAM en español ampliada con acciones requeridas para RDS' },
      { type: 'fix',    text: 'HelpModal — corregidos caracteres con encoding incorrecto (mojibake) en títulos y comentarios del componente' },
      { type: 'fix',    text: 'Helm — contextos con nombre ARN (EKS) ya se resuelven correctamente; se inyecta KUBECONFIG completo al invocar el CLI de helm' },
    ],
  },
  {
    version: '1.6.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'AWS Lambda — nuevo tab Logs con visor CloudWatch en vivo, selector de rango de tiempo (15 min–24 h) y opción de crear Log Group con retención configurable si no existe' },
      { type: 'new',    text: 'AWS Lambda — Tags movido a la grid del tab Básico (6 tabs en total: Básico, Configuración, Logs, Monitoreo, Aliases, Código)' },
      { type: 'new',    text: 'AWS ECR Deploy to K8s — opción de crear Service (ClusterIP / NodePort / LoadBalancer) junto al Deployment' },
      { type: 'fix',    text: 'AWS ECR Deploy to K8s — corregida indentación del YAML generado que causaba error "did not find expected - indicator"' },
      { type: 'fix',    text: 'AWS ECR Deploy to K8s — añadido --validate=false a kubectl apply para evitar fallos de conexión al API server durante la validación de esquema' },
      { type: 'fix',    text: 'AWS Athena — corregido error "sortedRows is not a function" al cargar la vista de tablas' },
      { type: 'fix',    text: 'AWS Lex y Athena — maxResults ajustado a 50 (límite del API) para evitar error de constraint' },
    ],
  },
  {
    version: '1.5.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'AWS DynamoDB — modal Info con billing mode, throughput, GSIs/LSIs, stream status y ARN; botón + Create Table con clave de partición, sort key, modo de facturación y RCU/WCU' },
      { type: 'new',    text: 'AWS Glue — panel Info con tipo de job, configuración de workers, script location, rol IAM, conexiones y argumentos' },
      { type: 'new',    text: 'AWS Athena — rediseño completo con 3 sub-pestañas: Workgroups, Data Sources (árbol catálogo→BD→tablas) y Query Editor con panel dividido, historial y exportación CSV' },
      { type: 'new',    text: 'AWS Lex — visor de Intents, Slots y Slot Types en pestañas dentro del detalle del bot' },
      { type: 'new',    text: 'AWS Step Functions — ejecución de state machines con payload personalizado; visor de ejecuciones con estado y salida' },
    ],
  },
  {
    version: '1.4.3',
    date: 'Abril 2026',
    items: [
      { type: 'fix',    text: 'Windows: el icono de la app ya no aparece como Electron genérico — se registra el App User Model ID (dev.kua.kuadashboard) para el taskbar, alt+tab y notificaciones' },
      { type: 'better', text: 'Descripción del paquete actualizada para reflejar el soporte multi-cloud (Kubernetes, AWS y GCP)' },
    ],
  },
  {
    version: '1.4.2',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'AWS Lambda — panel de detalle con 5 pestañas: Overview, Code Viewer, Variables de entorno, Triggers y Logs en tiempo real' },
      { type: 'new',    text: 'AWS EC2 — panel de detalle con 5 pestañas: Overview, Monitoring, Security Groups, Volumes y Console Output' },
      { type: 'new',    text: 'AWS EC2 — autenticación SSH con contraseña además de PEM; selector de archivo PEM integrado' },
      { type: 'new',    text: 'AWS EC2 — botones SSH/RDP conscientes del SO; canvas RDP integrado' },
    ],
  },
  {
    version: '1.4.1',
    date: 'Abril 2026',
    items: [
      { type: 'fix',    text: 'Auto-updater: try-catch en quitAndInstall con fallback a app.quit() para evitar cuelgues al instalar la actualización' },
      { type: 'fix',    text: 'UpdateNotice: muestra estado de error con botón "Descargar manualmente" que abre la página de releases' },
    ],
  },
  {
    version: '1.4.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'GCP Cloud Run Jobs — lista, ejecuta jobs y consulta historial de ejecuciones' },
      { type: 'new',    text: 'GCP Pub/Sub Subscriptions — lista suscripciones con tipo (push/pull), topic, filtro y ack deadline' },
      { type: 'new',    text: 'GCP VPC Networks — redes y subnets con CIDR, gateway, Private Google Access y Flow Logs' },
      { type: 'new',    text: 'GCP Cloud Monitoring — alert policies y uptime checks con estado habilitado/deshabilitado' },
      { type: 'new',    text: 'GCP Cloud Logging — panel de query interactivo con filtro, rango de horas y resultados en tiempo real' },
      { type: 'new',    text: 'GCP Cloud KMS — key rings y crypto keys por ubicación con propósito, algoritmo y rotación' },
      { type: 'better', text: 'Paginación (Load more) en Cloud Build, IAM Service Accounts y Cloud Tasks' },
      { type: 'better', text: 'Nueva sección Observabilidad en el sidebar GCP' },
    ],
  },
  {
    version: '1.3.3',
    date: 'Abril 2026',
    items: [
      { type: 'fix',  text: 'macOS: credenciales almacenadas en el Keychain nativo usando @napi-rs/keyring — elimina el error "KeytarStore requires keytar" sin necesidad de recompilar módulos nativos' },
      { type: 'fix',  text: 'macOS: el auto-updater genera archivo .zip además del .dmg, resolviendo el error "zip file not provided" al actualizar' },
    ],
  },
  {
    version: '1.3.2',
    date: 'Abril 2026',
    items: [
      { type: 'fix', text: 'macOS: el auto-updater ahora genera un archivo .zip además del .dmg, resolviendo el error "zip file not provided" al intentar actualizar la app' },
    ],
  },
  {
    version: '1.3.1',
    date: 'Abril 2026',
    items: [
      { type: 'fix', text: 'macOS: el auto-updater ahora genera un archivo .zip además del .dmg, resolviendo el error "zip file not provided" al intentar actualizar la app' },
    ],
  },
  {
    version: '1.3.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'GCP Fase 3: Cloud Spanner (instancias, bases de datos, query SQL), Memorystore Redis, Cloud Tasks, Cloud Scheduler, Cloud Build y IAM Service Accounts' },
      { type: 'new',    text: 'Interfaz bilingüe (EN/ES) — sistema i18n completo con más de 150 claves y cambio reactivo sin recargar' },
      { type: 'new',    text: 'Botones de acceso rápido en el header: cambio de idioma (🇪🇸/🇺🇸) y tema (☀/🌙)' },
      { type: 'new',    text: 'Vista Helm — explorador de releases Helm bajo Herramientas' },
      { type: 'new',    text: 'Menú de aplicación con About, DevTools y Check for Updates' },
      { type: 'fix',    text: 'WebSocket: eliminada URL hardcoded ws://localhost:7190 que rompía streams en setups con puerto no predeterminado' },
      { type: 'fix',    text: 'Terminal minimize: el panel ahora colapsa correctamente a 34px (solo cabecera)' },
      { type: 'fix',    text: 'Auto-updater: estado movido a store global — el botón "Reiniciar y actualizar" ya no desaparece al cerrar el modal' },
      { type: 'better', text: 'Documentación bilingüe VitePress completa — 17 páginas EN + ES cubriendo guía, features y arquitectura' },
    ],
  },
  {
    version: '1.2.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'GCP Fase 1-2: Secret Manager, Cloud Functions, GCS Browser, Artifact Registry, BigQuery, Cloud Workflows, Cloud DNS, Firestore' },
      { type: 'new',    text: 'Port forwarding persistente entre sesiones' },
      { type: 'new',    text: 'Soporte AWS completo: 19 servicios incluyendo API Gateway, CloudFront, Route 53, DynamoDB, DocumentDB, Glue, Athena, Cognito y más' },
      { type: 'better', text: 'Panel de terminal con múltiples pestañas, highlight de líneas y resize' },
    ],
  },
  {
    version: '1.1.2',
    date: 'Abril 2026',
    items: [
      { type: 'fix',  text: 'macOS: Electron hereda el PATH del login shell al arrancar desde el Dock, resolviendo la falta de kubectl, aws, gcloud y helm instalados con Homebrew' },
      { type: 'new',  text: 'Aviso de actualización disponible/lista dentro del modal de Ayuda' },
    ],
  },
  {
    version: '1.1.1',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'Credenciales AWS y GCP configurables desde el header global' },
      { type: 'new',    text: 'Botón de Local Shell siempre visible en el header' },
      { type: 'new',    text: 'Botón de Env Manager en el header, accesible desde cualquier proveedor' },
      { type: 'new',    text: 'Modal de Ayuda con Acerca de, Releases y Feedback/Issues' },
      { type: 'better', text: 'Iconos SVG uniformes en toda la interfaz (12px)' },
      { type: 'better', text: 'Botón Refresh en las vistas AWS y GCP con icono' },
    ],
  },
  {
    version: '1.1.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',    text: 'Selectores de credencial AWS y GCP en el header global' },
      { type: 'new',    text: 'Navegación lateral (sidebar) para AWS y GCP' },
      { type: 'new',    text: 'Soporte para AWS Step Functions con visualización de diagramas' },
      { type: 'new',    text: 'Soporte para AWS EventBridge — reglas, logs y métricas' },
      { type: 'new',    text: 'Soporte para AWS API Gateway — rutas e integraciones' },
      { type: 'new',    text: 'GCP Pub/Sub — gestiona tópicos' },
      { type: 'new',    text: 'GCP Cloud Functions — invoca y monitorea funciones' },
      { type: 'better', text: 'SSH directo a instancias EC2 desde el dashboard' },
      { type: 'better', text: 'Terminal local integrada con múltiples pestañas' },
    ],
  },
  {
    version: '1.0.0',
    date: 'Enero 2026',
    items: [
      { type: 'new', text: 'Dashboard Kubernetes con gestión de Pods, Deployments, Services y más' },
      { type: 'new', text: 'Soporte multi-contexto y multi-namespace' },
      { type: 'new', text: 'Vista AWS — EC2, ECS, EKS, Lambda, S3, ECR, VPC' },
      { type: 'new', text: 'Vista GCP — Cloud Run, GKE, Compute VMs, Cloud SQL, Storage' },
      { type: 'new', text: 'Env Manager para gestionar perfiles de credenciales cifradas' },
      { type: 'new', text: 'Port forwarding visual' },
      { type: 'new', text: 'Logs en streaming y terminal exec para pods' },
    ],
  },
]
