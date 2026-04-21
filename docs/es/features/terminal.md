# Terminal & Shell

KuaDashboard incluye un potente panel de terminal integrado que te da acceso interactivo completo a shells de pods, streams de logs, sesiones SSH a instancias EC2 y una shell local del sistema — todo desde la misma ventana.

![KuaDashboard — vista de pods](/screenshots/dashboard-pods.png)

## Descripción General

El panel de terminal se encuentra en la parte inferior de la vista principal y soporta **múltiples pestañas simultáneas**, cada una con código de color por contexto:

| Contexto | Color | Descripción |
|---|---|---|
| `pod` | Azul | Stream de logs en tiempo real de un pod de Kubernetes |
| `exec` | Morado | Sesión de shell interactiva dentro de un pod |
| `local` | Verde | Shell local del sistema (bash / zsh / PowerShell) |
| `ec2` | Teal | Sesión SSH en navegador a una instancia EC2 |

---

## Abrir una Pestaña de Terminal

### Logs de Pod

Transmite logs en tiempo real de cualquier pod en ejecución:

1. Selecciona un pod en la tabla de recursos de Kubernetes
2. Haz clic en la acción **Logs**
3. Se abre una nueva pestaña con output en streaming en vivo vía WebSocket

Para **pods multi-contenedor**, selecciona el contenedor desde el dropdown en el encabezado del terminal.

Activa **Prev** en la barra de herramientas para incluir también el output de la instancia anterior del contenedor (útil tras un reinicio por crash).

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

### SSH a EC2

Abre una sesión SSH en el navegador a cualquier instancia EC2 en ejecución:

1. Ve a **Cloud > AWS > pestaña EC2**
2. Haz clic en **SSH** en una instancia con estado `running`
3. Se abre una pestaña de terminal con una sesión SSH autenticada

---

## Barra de Herramientas del Terminal

La barra de herramientas del encabezado ofrece controles rápidos para la pestaña activa:

| Control | Descripción |
|---|---|
| Selector de contenedor | Cambiar contenedor en sesiones de pods multi-contenedor |
| Toggle **Prev** | Incluir logs de la instancia anterior del contenedor (solo en pestañas de logs) |
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

Las pestañas de shell (exec, local, EC2) muestran una barra de entrada en la parte inferior con:

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
