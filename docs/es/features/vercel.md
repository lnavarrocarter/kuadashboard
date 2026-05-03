# Integración Vercel

KuaDashboard proporciona un panel completo de gestión de Vercel accesible desde la pestaña del proveedor **Vercel**. Administra proyectos, deployments, dominios, variables de entorno y funciones serverless sin salir del dashboard.

## Autenticación

Las credenciales de Vercel pueden configurarse de dos formas:

| Método | Descripción |
|---|---|
| **API Token** | Genera un token en [vercel.com/account/tokens](https://vercel.com/account/tokens) y almacénalo con el Env Manager (icono de llave) |
| **OAuth (solo Electron)** | Haz clic en **Connect with Vercel** en el diálogo de agregar conexión para autorizar desde el navegador — sin copiar y pegar tokens |

### Usando un API Token

1. Abre el **Env Manager** (icono de llave en la barra de herramientas)
2. Haz clic en **Add Connection** y selecciona **Vercel** como proveedor
3. Ingresa tu `VERCEL_API_TOKEN`
4. Opcionalmente agrega un `VERCEL_TEAM_ID` si el token pertenece a una cuenta de equipo de Vercel (formato: `team_XXXXXXXXXXXX`)
5. Dale un nombre al perfil y guarda

### Usando OAuth (solo app Electron)

1. Haz clic en **Add Connection** y selecciona **Vercel**
2. Haz clic en **Connect with Vercel** — se abre la página de autorización de Vercel en tu navegador predeterminado
3. Autoriza KuaDashboard — Vercel redirige de vuelta a la app vía el deep-link `kua://`
4. El perfil se guarda automáticamente y queda seleccionado como activo

> **Nota:** OAuth requiere que `VERCEL_OAUTH_CLIENT_ID` y `VERCEL_OAUTH_CLIENT_SECRET` estén configurados en el entorno de la app. Estos están incluidos en la versión oficial.

---

## Proyectos

La pestaña **Projects** muestra todos los proyectos de Vercel accesibles con el perfil activo.

| Columna | Descripción |
|---|---|
| Nombre | Nombre del proyecto — haz clic para navegar a sus deployments |
| Framework | Framework detectado (Next.js, Vite, etc.) |
| Último Deploy | Estado del deployment más reciente (`READY`, `ERROR`, `BUILDING`, etc.) |
| URL | URL de producción del último deployment |
| Repositorio | Repositorio Git vinculado |
| Actualizado | Fecha de última actividad |

**Acciones por proyecto:**

- **Deployments** — cambia a la pestaña Deployments filtrada por este proyecto
- **Domains** — cambia a la pestaña Domains filtrada por este proyecto
- **Env Vars** — cambia a la pestaña Env Vars filtrada por este proyecto

---

## Deployments

Lista todos los deployments del proyecto seleccionado. Usa el filtro de **destino** para filtrar por entorno:

- **All** — todos los deployments
- **Production** — solo `target: production`
- **Preview** — solo `target: preview`

| Columna | Descripción |
|---|---|
| Deployment | UID del deployment |
| Estado | `READY` / `ERROR` / `BUILDING` / `QUEUED` / `CANCELED` |
| Destino | `production` o `preview` |
| URL | URL del deployment |
| Creador | Email/usuario que lo disparó |
| Creado | Fecha de creación |

**Acciones por deployment:**

- **Logs** — abre el panel de logs de construcción en tiempo real (SSE streaming)
- **Functions** — ver las funciones serverless/edge de este deployment
- **Redeploy** — dispara un nuevo deployment con el mismo código fuente
- **Promote** — promueve un deployment de preview a producción *(oculto para deployments de producción)*
- **Cancel** — cancela un deployment en estado `BUILDING` o `QUEUED`

### Logs de Build

Haz clic en **Logs** en cualquier deployment para abrir el panel de logs. Los logs se transmiten en tiempo real vía Server-Sent Events. El panel soporta:

- **Auto-scroll** — mantiene la vista anclada al último mensaje
- **Limpiar** — borra el buffer de logs actual
- Coloración por tipo de evento: `stdout` (blanco), `stderr` (rojo), `command` (amarillo), estado de deployment (azul)

---

## Dominios

Lista todos los dominios personalizados configurados en el proyecto seleccionado.

| Columna | Descripción |
|---|---|
| Dominio | Nombre completo del dominio |
| Dominio raíz | Dominio apex |
| Rama | Rama Git a la que está mapeado el dominio (si aplica) |
| Redirige a | URL de destino si el dominio es una redirección |
| Verificado | Si Vercel ha verificado los registros DNS |

---

## Variables de Entorno

Lista todas las **claves** de variables de entorno del proyecto seleccionado. Los valores son intencionalmente nunca mostrados ni transmitidos — esto es una medida de seguridad para prevenir la exposición accidental de secretos.

| Columna | Descripción |
|---|---|
| Clave | Nombre de la variable |
| Tipo | `plain`, `secret` o `sensitive` |
| Destino | Entornos donde aplica (production / preview / development) |

---

## Funciones

Lista las funciones serverless y edge incluidas en un deployment seleccionado.

| Columna | Descripción |
|---|---|
| Función | Ruta del archivo dentro del deployment |
| Tipo | `lambda` (serverless Node.js) o `edge` |
| Modo | Modo de ejecución reportado por Vercel |

> Selecciona un deployment en la pestaña Deployments primero — la pestaña Functions muestra las funciones del deployment actualmente seleccionado.

---

## Cambiar de Perfil

Usa el dropdown de perfil en el encabezado para cambiar entre múltiples cuentas o perfiles de equipo de Vercel. La selección se persiste entre sesiones.
