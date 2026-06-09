# 🗺️ KuaDashboard — Roadmap del Producto

> **Versión actual:** v1.10.0
> **Última actualización:** 2026-06-09

---

## 🌟 Visión

**KUA (Know Unified Administration)** aspira a ser el panel de control universal open source para la administración de infraestructura cloud-native. No una consola más, sino el **único punto de entrada** donde confluyen todos los entornos — Kubernetes, AWS, GCP, Vercel y los que vengan — con capacidades de observación, operación y automatización.

> "Un solo lugar para conocer y operar toda tu infraestructura distribuida."

---

## 📦 Corto Plazo — v1.10 → v2.0 (Q3 2026)

Mejoras incrementales sobre la base actual, priorizando madurez y cobertura.

### Proveedores Cloud
| Feature | Prioridad | Esfuerzo |
|---|---|---|
| **Azure** — módulo inicial (VMs, AKS, Blob Storage) | Alta | 3-4 sprints |
| **DigitalOcean** — módulo básico (Droplets, K8s, Spaces) | Media | 2 sprints |
| **AWS RDS** — modal de detalle completo (ya empezado) | Alta | 1 sprint |
| **GCP** — completar servicios faltantes (Dataflow, Dataproc, Bigtable) | Media | 2 sprints |

### Kubernetes
| Feature | Prioridad | Esfuerzo |
|---|---|---|
| **Custom Resource Definitions (CRD)** — exploración y edición de recursos personalizados | Alta | 2 sprints |
| **Pod resource graphs** — CPU/memory timeline en panel de detalle | Media | 1 sprint |
| **Network policies** — visor y editor visual | Media | 2 sprints |
| **ArgoCD integración** — ver aplicaciones y sincronización | Media | 2 sprints |

### UX / Calidad de Vida
| Feature | Prioridad | Esfuerzo |
|---|---|---|
| **Dashboard home page** — resumen cross-provider con widgets configurables | Alta | 3 sprints |
| **Multi-ventana / tabs** — abrir vistas en ventanas separadas | Media | 2 sprints |
| **Keyboard shortcuts** — navegación completa por teclado | Baja | 1 sprint |
| **Filtros guardados** — presets de filtros por namespace/región | Baja | 1 sprint |

### Infraestructura
| Feature | Prioridad | Esfuerzo |
|---|---|---|
| **Migración a TypeScript** en backend (routes/) | Media | 3 sprints |
| **Test coverage** — subir de 241 tests a 500+ (backend + frontend) | Alta | Continuo |
| **CI/CD** — GitHub Actions con lint, test, build en cada PR | Alta | 1 sprint |
| **Docker Compose** — entorno dev listo con docker | Baja | 1 sprint |

---

## 🚀 Mediano Plazo — v2.0 → v3.0 (Q4 2026 — Q1 2027)

Features transformacionales que agregan capacidades no existentes hoy.

### ⚡ Automatización Inteligente
| Feature | Descripción |
|---|---|
| **Runbooks automatizados** | Secuencias de acciones guionadas (ej: "drenar nodo + cordon + reemplazar pod") |
| **Webhook receiver** | Endpoint para recibir alerts de AWS/GCP/K8s y gatillar acciones |
| **Scheduled actions** | Programar start/stop de instancias, escalado, backups |
| **Terraform integración** | Explorar state files y lanzar applies desde KUA |

### 💰 FinOps y Costos
| Feature | Descripción |
|---|---|
| **AWS Cost Explorer** | Gráficos de gasto por servicio, cuenta, tag |
| **GCP Billing** | Reportes de costo desde BigQuery export |
| **Kubecost/K8s cost** | Costo por namespace, deployment, pod |
| **Budget alerts** | Notificaciones visuales cuando se excede presupuesto |

### 👥 Multi-usuario y Equipos
| Feature | Descripción |
|---|---|
| **Autenticación local + OAuth** | Login con Google/GitHub/Azure AD |
| **RBAC interno** | Permisos por usuario/rol sobre providers y recursos |
| **Compartir sesiones** | Compartir enlace temporal a una vista (read-only) |
| **Audit log centralizado** | Vista de acciones de todos los usuarios |

### 🔌 Extensibilidad
| Feature | Descripción |
|---|---|
| **Plugin system** | Cargar módulos externos como providers nuevos |
| **API pública REST/WebSocket** | Documentación OpenAPI para integraciones externas |
| **CLI companion** | Herramienta de línea de comandos para operaciones rápidas |

---

## 🌌 Largo Plazo — v3.0+ (2027+)

La visión ambiciosa del producto.

### Proveedores y Stack Completo
- **Multi-cloud completo**: AWS, GCP, Azure, Oracle Cloud, DigitalOcean, Linode, Vercel, Cloudflare
- **On-premise**: vCenter/ESXi, Proxmox, OpenStack
- **GitOps**: Integración directa con ArgoCD, FluxCD, GitLab CI
- **Service Mesh**: Istio, Linkerd — visualización de malla

### IA y Automatización Inteligente
- **Asistente conversacional** integrado con Bedrock/Llama — "muéstrame los pods con errores en prod"
- **Análisis predictivo** — detectar patrones anómalos antes de que sean incidentes
- **Generación de runbooks** automáticos desde logs de incidentes

### Observabilidad Unificada
- **Métricas, logs y traces** en un solo panel (reemplazar consolas separadas)
- **Distributed tracing** — correlación entre servicios multi-cloud
- **SLI/SLO tracking** — dashboards de confiabilidad por servicio

### Colaboración
- **Multi-sesión en tiempo real** — variant-style colaborativo
- **Comentarios y anotaciones** sobre recursos
- **Incident response** — flujo de detección → diagnóstico → resolución

---

## 📊 Métricas de Éxito

| Métrica | Objetivo v2.0 | Objetivo v3.0 |
|---|---|---|
| **Proveedores cloud** | 5+ | 10+ |
| **Tests automatizados** | 500+ | 2000+ |
| **Estrellas GitHub** | 200+ | 1000+ |
| **Contribuidores** | 10+ | 50+ |
| **Descargas/app** | 5,000+ | 50,000+ |
| **Tiempo entre releases** | 2-3 semanas | 1-2 semanas |
| **Disponibilidad API** | 99.9% | 99.99% |
| **Soporte de idiomas** | 2 (EN/ES) | 5+ (EN, ES, PT, FR, DE) |

---

## 📋 Notas del Proceso

- Las prioridades pueden cambiar según feedback de usuarios y tendencias del mercado.
- Cada release sigue el flujo: **Feature freeze → QA → Beta → RC → Release**.
- El changelog completo se mantiene en [`docs/changelog.md`](./changelog.md).
- Este roadmap se revisa y actualiza al inicio de cada ciclo (cada 2-3 releases).

---

> **¿Feedback o sugerencias?** Abre un issue en [github.com/lnavarrocarter/kuadashboard](https://github.com/lnavarrocarter/kuadashboard)
