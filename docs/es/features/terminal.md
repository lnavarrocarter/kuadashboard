# Terminal & Shell

KuaDashboard incluye un potente panel de terminal integrado que te da acceso interactivo completo a shells de pods, streams de logs, sesiones SSH/RDP/SSM a instancias EC2, logs de Cloud Run (GCP) y de despliegues de Vercel, y una shell local del sistema — todo desde la misma ventana.

![KuaDashboard — vista de pods](/screenshots/dashboard-pods.png)

## Descripción General

Toda sesión abierta desde cualquier parte de la app — desde una tabla de recursos, desde Architecture/Observability o desde el workspace dedicado de Console — comparte la misma lista de sesiones. El panel rápido en la parte inferior y el **workspace de Console** dedicado (ícono de consola del encabezado, en cualquier módulo) siempre muestran las mismas pestañas; abrir o cerrar una en cualquiera de los dos se refleja de inmediato en el otro.

El panel de terminal soporta **múltiples pestañas simultáneas**, cada una con código de color por contexto:

| Contexto | Color | Descripción |
|---|---|---|
| `pod` | Azul | Stream de logs en tiempo real de un pod de Kubernetes |
| `workload` | Azul | Stream de logs resuelto desde el selector de un Deployment, StatefulSet o DaemonSet |
| `exec` | Morado | Sesión de shell interactiva dentro de un pod |
| `local` | Verde | Shell local del sistema (bash / zsh / PowerShell) |
| `ec2` | Teal | Sesión SSH/RDP en navegador a una instancia EC2 |
| `ssm` | Ámbar | Shell de AWS Systems Manager Session Manager a una instancia EC2 (sin necesidad de clave SSH) |
| `gcp-logs` | Celeste | Logs en vivo de un servicio de GCP Cloud Run |
| `vercel` | Gris pizarra | Logs en vivo de un despliegue de Vercel |

---

## Abrir una Pestaña de Terminal

### Logs de Pod y Workload

Transmite logs en tiempo real de cualquier pod o workload soportado:

1. Selecciona un pod, deployment, statefulset o daemonset en la tabla de recursos de Kubernetes
2. Haz clic en la acción **Logs**
3. Se abre una nueva pestaña con output en streaming en vivo vía WebSocket

Para **pods multi-contenedor**, selecciona el contenedor desde el dropdown en el encabezado del terminal.

Para workloads, KuaDashboard resuelve los pods actuales usando el selector del recurso y antepone el nombre del pod origen cuando el stream incluye múltiples pods.

Activa **Prev** en la barra de herramientas para incluir también el output de la instancia anterior del contenedor (útil tras un reinicio por crash).

Usa el botón de búsqueda en la barra de herramientas para filtrar logs por texto, rango de fecha/hora o ambos. Los logs filtrados pueden descargarse como archivo `.log`.

### Pod Exec (Shell)

Abre una sesión de shell interactiva directamente dentro de un pod:

1. Selecciona un pod en la tabla de recursos de Kubernetes
2. Haz clic en la acción **Shell**
3. Se abre una pestaña de terminal con una shell PTY en vivo

La sesión exec soporta:
- Modo PTY completo (colores, movimiento de cursor, redimensionado del terminal)
- Selección de contenedor para pods multi-contenedor
- Atajos de teclado estándar (Ctrl+C, Ctrl+D, Tab completion)

### Shell Local

Accede a una shell local del sistema sin salir del dashboard:

1. Haz clic en **Shell Local** en la sección **Herramientas** de la barra lateral
2. Se abre una pestaña de terminal con tu shell del sistema (bash / zsh / PowerShell)

Usa la shell local para ejecutar `kubectl`, `aws`, `gcloud`, `helm` o cualquier herramienta CLI sin cambiar de ventana.

### SSH/RDP a EC2

Abre una sesión SSH o RDP en el navegador a cualquier instancia EC2 en ejecución:

1. Ve a **Cloud > AWS > pestaña EC2**
2. Haz clic en **SSH** para instancias Linux o **RDP** para instancias Windows
3. Se abre una sesión remota con el formulario de conexión correspondiente

Las sesiones remotas son persistentes. Cerrar la ventana solo la oculta; el WebSocket permanece vivo y la sesión puede restaurarse desde la bandeja flotante de sesiones. Usa **Disconnect** dentro de la sesión, o cierra el tab de la bandeja, cuando quieras terminarla.

### AWS Systems Manager (SSM)

Abre una shell a una instancia EC2 sin necesidad de clave SSH, regla de security group o IP pública — Session Manager solo necesita el SSM Agent y un instance profile:

1. Ve a **Cloud > AWS > pestaña EC2**
2. Haz clic en **⚡ SSM** sobre cualquier instancia en ejecución (funciona tanto para instancias Linux como Windows)
3. Se abre una pestaña de Console y conecta usando el perfil de credenciales seleccionado actualmente para AWS

SSM requiere el binario `session-manager-plugin` instalado localmente — al conectar desde el lanzador de SSM del workspace de Console dedicado se muestra automáticamente un aviso de instalación si falta. AWS no cobra un cargo adicional por usar Session Manager.

### Logs de GCP Cloud Run

Sigue en vivo los logs de un servicio de Cloud Run, en una pestaña de Console reconectable, en vez de la vista de snapshot en línea:

1. Ve a **Cloud > GCP > Cloud Run**, selecciona un servicio y abre su pestaña **Logs**
2. Haz clic en **Open in Console** junto a **Refresh**
3. Se abre una pestaña de Console y comienza a seguir nuevas entradas de log — no necesitas escribir un project id de GCP, se resuelve desde el perfil de credenciales seleccionado

### Logs de Despliegues de Vercel

Sigue en vivo los logs de build/runtime de un despliegue en una pestaña de Console reconectable, junto al visor de logs en línea existente:

1. Ve a **Cloud > Vercel > Projects** y busca un despliegue
2. Haz clic en **Open in Console** junto a **Logs**
3. Se abre una pestaña de Console y comienza a transmitir nuevas líneas de log

---

## Barra de Herramientas del Terminal

La barra de herramientas del encabezado ofrece controles rápidos para la pestaña activa:

| Control | Descripción |
|---|---|
| Selector de contenedor | Cambiar contenedor en sesiones de pods multi-contenedor |
| Toggle **Prev** | Incluir logs de la instancia anterior del contenedor (solo en pestañas de logs) |
| Búsqueda / filtros | Filtrar logs por texto y rango de fecha serializada |
| Descarga | Exportar la vista filtrada actual a un archivo `.log` |
| ✦ Limpiar | Borrar todo el output actual de la pestaña activa |
| ⏎ Ajustar texto | Activar/desactivar ajuste de línea para logs largos |
| ↓ Ir al final | Saltar al final del buffer de output |
| 📁 Explorador de archivos | Alternar el panel lateral de archivos (solo en pestañas de shell local) |
| ? Atajos de teclado | Mostrar el overlay de ayuda con atajos disponibles |
| ■ Detener | Enviar SIGINT / terminar el stream o sesión activa |
| ⬡ Desprender | Abre el terminal en una ventana flotante del navegador |
| — Minimizar | Colapsar el panel a solo la barra de pestañas |
| × Cerrar todo | Cerrar todas las pestañas de terminal abiertas |

---

## Barra de Entrada

Las pestañas de shell (exec, local, EC2, SSM) muestran una barra de entrada en la parte inferior con:

- **Prompt de comando** (❯) — verde cuando está conectado, gris cuando está desconectado
- **Campo de entrada** — escribe tu comando y presiona Enter para enviar
- **Chip de sugerencia** — se muestra cuando hay una sugerencia de autocompletado disponible; haz clic para aplicarla
- **✕ Interrumpir** — envía Ctrl+C para terminar el comando en ejecución

### Atajos de Teclado

| Atajo | Acción |
|---|---|
| `↑` / `↓` | Navegar historial de comandos |
| `Tab` | Autocompletado de rutas |
| `Enter` | Enviar comando |
| `Ctrl+C` | Interrumpir (SIGINT) |
| `Ctrl+D` | EOF / cerrar sesión |
| `Ctrl+L` | Limpiar output |

---

## Explorador de Archivos (Shell Local)

Cuando hay una pestaña de **shell local** activa, haz clic en el botón 📁 para abrir el panel del explorador de archivos en el lado izquierdo del terminal.

| Acción | Descripción |
|---|---|
| Clic en 📁 carpeta | Navegar al directorio (también ejecuta `cd` en la shell) |
| Clic en 📄 archivo | Previsualizar el contenido del archivo en el output del terminal |
| Doble clic en archivo | Insertar la ruta completa en el campo de entrada de comandos |
| Clic en `↑` (entrada superior) | Navegar al directorio padre |
| Clic en ↻ (breadcrumb) | Actualizar el listado del directorio actual |

Una ruta de navegación (breadcrumb) muestra tu ubicación actual. El directorio de trabajo activo también se muestra en el footer del terminal.

---

## Resaltado de Líneas

Las líneas de log se colorean automáticamente para ayudarte a detectar problemas de un vistazo:

| Color | Significado |
|---|---|
| 🔴 Rojo | Error / excepción / stderr |
| 🟡 Amarillo | Advertencia |
| 🟢 Verde | Éxito / OK |
| ⚫ Dim | Mensajes del sistema / meta |

---

## Footer del Terminal

La barra inferior del panel muestra:

- **Texto de estado** — estado de la conexión (Connected, Reconnecting, Stopped, etc.)
- **Directorio de trabajo** — `cwd` actual para pestañas de shell local
- **Conteo de líneas** — número total de líneas de output en la pestaña actual

---

## Redimensionar el Panel

Arrastra el **handle de redimensionado** en el borde superior del panel de terminal para ajustar su altura. La altura se preserva mientras el panel está abierto. Haz clic en **—** para colapsarlo a solo la barra de pestañas y vuelve a hacer clic en **—** para restaurarlo.

---

## Múltiples Pestañas

Puedes tener tantas pestañas de terminal abiertas como necesites:

- Transmitir logs de múltiples pods simultáneamente
- Mantener una shell local abierta junto a una sesión exec
- Cambiar entre pestañas al instante con un solo clic
- Cerrar pestañas individuales con el botón **✕** de cada pestaña
- El contenido de las pestañas se preserva en memoria mientras no está activo

---

## Reconexión y Persistencia de Sesión

Recargar la ventana restaura tus pestañas abiertas y su orden, pero nunca retoma en silencio una sesión remota en vivo — una pestaña restaurada siempre vuelve desconectada, mostrando su output previo. Haz clic en **Reconnect** (disponible tanto en el panel rápido como en las acciones de fila del workspace de Console) para restablecerla.

El historial de comandos se recuerda por objetivo exacto (por pod/contenedor, por host EC2, por shell local), de modo que cambiar entre recursos nunca mezcla historiales. Usa la acción **Clear history** (por pestaña en el panel rápido, o "Clear all history" en el encabezado del workspace de Console) para reiniciarlo.

---

## Comandos CLI Comunes (Referencia Rápida)

| Comando | Propósito |
|---|---|
| `ls -la` | Listar archivos con detalles |
| `pwd` | Mostrar directorio actual |
| `env` | Imprimir variables de entorno |
| `ps aux` | Mostrar procesos en ejecución |
| `cat /etc/os-release` | Información del OS / distro |
| `df -h` | Uso de disco por punto de montaje |
| `top` / `htop` | Uso de CPU y memoria |
| `curl -I <url>` | Verificar cabeceras de respuesta HTTP |
