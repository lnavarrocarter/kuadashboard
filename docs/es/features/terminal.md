# Terminal & Shell

KuaDashboard incluye un panel de terminal integrado para sesiones exec en pods, streams de logs y acceso a shell local.

## Panel de Terminal

El panel de terminal se encuentra en la parte inferior de la vista principal y soporta múltiples pestañas:

- **Streams de logs** — Salida de logs en tiempo real vía WebSocket
- **Sesiones exec** — Shell interactiva en pods
- **Shell local** — Terminal del sistema para comandos locales

## Logs de Pod

Transmite logs de cualquier pod en ejecución:
1. Selecciona un pod en la tabla de recursos
2. Haz clic en la acción **Logs**
3. Se abre una nueva pestaña con salida en streaming en vivo

Para pods multi-contenedor, selecciona el contenedor específico desde el dropdown.

## Pod Exec (Shell)

Abre una sesión de shell interactiva:
1. Selecciona un pod en la tabla de recursos
2. Haz clic en la acción **Shell**
3. Se abre una pestaña de terminal con el prompt de shell

La shell soporta:
- Modo PTY completo (colores, movimiento de cursor)
- Atajos de teclado estándar (Ctrl+C, tab completion, etc.)
- Redimensionado al cambiar la ventana

## Shell Local

Accede a una sesión de terminal local desde la barra lateral:
1. Haz clic en **Shell Local** en la sección de Herramientas
2. Se abre una nueva pestaña de terminal con tu shell del sistema

Esto es útil para ejecutar `kubectl`, `aws`, `gcloud` u otros comandos CLI sin salir del dashboard.

## Gestión de Pestañas

- Múltiples pestañas de terminal pueden estar abiertas simultáneamente
- Cierra pestañas individuales con el botón ×
- Las pestañas preservan su contenido durante la sesión
