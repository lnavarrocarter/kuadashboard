# 📖 Manual de Usuario — KuaDashboard

> **KUA (Know Unified Administration)** — panel de control universal para administrar infraestructura cloud-native desde un solo lugar: Kubernetes, AWS, GCP y Vercel.

Versión documentada: **v1.10.x**

---

## Índice

| Entorno | Módulos | Documento |
|---|---|---|
| ☸️ **Kubernetes** | 32 módulos: Workloads, Red, Configuración, Almacenamiento, Clúster y Helm | [kubernetes.md](./kubernetes.md) |
| ☁️ **AWS** | 22 servicios: Cómputo, Contenedores, Redes, Storage, Bases de datos, Analítica, Integración, AI y Seguridad | [aws.md](./aws.md) |
| 🌐 **GCP** | 25 servicios: Cómputo, Bases de datos, Storage, Serverless, Mensajería, Seguridad, Analítica y Observabilidad | [gcp.md](./gcp.md) |
| ▲ **Vercel** | 12 módulos: Proyectos, Deployments, Configuración y Cuenta | [vercel.md](./vercel.md) |

---

## Conceptos generales

### Barra superior (header)

Presente en toda la aplicación:

- **Tabs de proveedor** — Kubernetes · AWS · GCP · Vercel. Cambian el entorno activo manteniendo el estado de cada vista.
- **Selector de contexto/perfil** — según el proveedor activo:
  - *Kubernetes*: contexto del kubeconfig + namespace.
  - *AWS / GCP / Vercel*: perfil de credenciales gestionado por el **Env Manager**.
- **Auto-refresh** — desactivado, 30 s, 1 min, 2 min o 5 min por vista.
- **Botones de acceso rápido** — Env Manager (🔑 credenciales cifradas), Local Shell (terminal integrada), idioma (🇪🇸/🇺🇸), tema (☀/🌙), Ayuda (Acerca de, Versiones, Feedback).

### Gestión de credenciales (Env Manager)

Todos los perfiles de AWS, GCP y Vercel se almacenan **cifrados localmente** (Keychain nativo en macOS). Ningún dato de credenciales sale de tu máquina: la app llama a las APIs cloud directamente.

### Patrón master-detail

Las vistas principales usan un patrón uniforme: **lista de recursos a la izquierda → panel de detalle con tabs a la derecha**. Esto aplica a Cognito, Athena, Lex (AWS), Cloud Run, VMs, SQL, Functions, Artifact Registry (GCP), entre otros.

### Terminal integrada

Una terminal local multi-pestaña está disponible en cualquier vista (icono `>_`), con soporte de copy/paste nativo, búsqueda y descarga de logs.

---

> ⚠️ **Nota sobre las capturas**: las imágenes de este manual se tomaron sobre entornos reales de desarrollo. Los nombres de recursos, IPs e identificadores que aparecen son del entorno de pruebas del autor.
