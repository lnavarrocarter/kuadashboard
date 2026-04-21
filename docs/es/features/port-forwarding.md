# Port Forwarding

KuaDashboard proporciona un gestor visual de port-forward construido sobre la API de port-forward de Kubernetes.

## Inicio Rápido

1. Haz clic en un **Service** en la tabla de recursos
2. Haz clic en el botón de acción **Port Forward**
3. Elige el puerto local y el puerto destino
4. El forward inicia inmediatamente

## Panel de Port Forward

Alterna el panel con el botón **Puertos** en el encabezado. El panel muestra todos los forwards activos:

- **Nombre del Service/Pod** y namespace
- Mapeo **Puerto local** → **Puerto remoto**
- Indicador de **Estado** (activo/error)
- Botón **Detener** para terminar forwards individuales

## Funcionalidades

- **Sesiones persistentes** — Los port forwards activos sobreviven a recargas de página (almacenados en localStorage)
- **Auto-reconexión** — Restaura automáticamente los forwards al iniciar la app
- **Modo manual** — Crea forwards especificando namespace, recurso y puertos manualmente
- **Múltiples forwards** — Ejecuta tantos forwards simultáneos como necesites
- **Contador badge** — El botón del encabezado muestra el número de forwards activos

## Port Forward Manual

Haz clic en el botón **Puertos**, luego **Agregar Manual** para especificar:
- Namespace
- Tipo de recurso (Service o Pod)
- Nombre del recurso
- Puerto local
- Puerto remoto
