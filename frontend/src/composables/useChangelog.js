/**
 * composables/useChangelog.js
 * Single source of truth for the application changelog.
 * Used by both HelpModal (full history) and WelcomeModal (latest release only).
 */

export const CHANGELOG_VERSION = '1.4.3'

export const CHANGELOG = [
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
