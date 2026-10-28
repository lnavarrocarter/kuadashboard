# Agentes IA

KUA ya encuentra problemas con chequeos deterministas: el **Advisor** de cada overview y la **inteligencia de logs** de los log groups de CloudWatch en caché. Estas dos funcionalidades le entregan esos hallazgos a un agente de código (Claude Code, Codex, ChatGPT, Cursor…) para que los corrija en tu código e infraestructura.

Ninguna de las dos usa IA dentro de KUA ni llama a un proveedor cloud: reutilizan datos que KUA ya tiene, así que no tienen costo.

## Briefs para agentes

El Advisor (overviews de AWS, GCP y Kubernetes, y la lente de producto de KUApps) y las recomendaciones de la inteligencia de logs tienen dos botones:

- **Copiar para agente IA**: copia un brief en Markdown al portapapeles.
- **Descargar brief (.md)**: guarda el mismo brief como archivo.

El brief es una tarea autocontenida, escrita en el idioma de la app:

| Sección | Contenido |
| --- | --- |
| Contexto | Proveedor, cuenta, perfil, región, proyecto, namespace, contexto de Kubernetes o log group |
| Tu tarea | Reglas de trabajo para el agente: verificar primero el estado actual, corregir por severidad y causa raíz, cambiar la infraestructura como código en vez de la consola, pedir confirmación antes de operaciones destructivas o con costo, nunca exponer secretos, terminar con un informe |
| Hallazgos / Recomendaciones | Severidad, regla, recursos afectados y documentación. Para logs: actividad, anomalías frente a los 7 días anteriores, firmas de error sanitizadas, datos sensibles encontrados, consultas de Logs Insights y ejemplos de código |
| Cómo verificar | Cómo confirmar la corrección en KUA y con la CLI del proveedor |

Pégalo en cualquier agente o chat. Funciona con cualquier modelo porque es Markdown simple.

## Servidor MCP

El servidor MCP de KUA permite que los agentes compatibles con el [Model Context Protocol](https://modelcontextprotocol.io) le pregunten directamente a KUA en vez de pegar briefs. Corre en tu equipo por stdio y lee la API de KUA, así que **KuaDashboard debe estar abierto**.

### Herramientas

Todas leen, excepto `apply_application_change`, que aplica un cambio de KUApps que aprobaste (ver Cambiar KUApps desde un agente).

| Herramienta | Qué devuelve |
| --- | --- |
| `list_profiles` | Perfiles de AWS, GCP y Vercel (id, nombre, proveedor). Cuando KUA no tiene perfiles de AWS o GCP, lista además los perfiles de la CLI de AWS (`~/.aws/config`) y las configuraciones de gcloud de este equipo como `local:<nombre>`. Nunca devuelve credenciales |
| `check_profile` | Comprobación de acceso de solo lectura para AWS, GCP, Vercel o un contexto Kubernetes. Informa conexión, permisos de lectura probados y un siguiente paso seguro; no devuelve credenciales ni errores crudos del proveedor |
| `aws_advisor` (Pro) | Hallazgos del Advisor de AWS para un perfil (caché de 15 min; `refresh` vuelve a analizar con APIs gratuitas) |
| `gcp_advisor` (Pro) | Hallazgos del Advisor de GCP del overview guardado; usa `refresh: true` para forzar un inventario y análisis nuevos. Indica si el snapshot es reciente, está en caché o vencido |
| `vercel_advisor` (Pro) | Hallazgos del Advisor de Vercel para la cuenta o el team de un perfil (caché de 15 min; `refresh` vuelve a analizar con lecturas gratuitas de la API de Vercel). Nunca lee los valores de las variables |
| `kubernetes_advisor` (Pro) | Hallazgos del Advisor de Kubernetes para el contexto actual (`namespace` opcional) |
| `list_log_groups` | Log groups de CloudWatch en la caché de KUA para un perfil |
| `log_intelligence` | Brief de un log group en caché: tasas de error, anomalías, errores parecidos, firmas, recomendaciones, consultas |
| `search_logs` | Errores recurrentes de los log groups en caché buscados por significado, en cualquier idioma (requiere el ML local activado en KUA); `provider: "kubernetes"` busca en los workloads de Kubernetes en caché |
| `list_kube_log_workloads` | Workloads de Kubernetes cuyos logs de pods guarda KUA para el contexto actual |
| `kube_log_intelligence` | Brief de un workload de Kubernetes en caché: tasas de error, anomalías, errores parecidos, recomendaciones, consultas |
| `list_kubernetes_contexts` | Contextos locales de Kubernetes (nombres de contexto y cluster; sin direcciones del API server ni credenciales) |
| `kubernetes_architecture` | Inventario en vivo y de solo lectura de workloads, Pods, Services, Ingresses, PVC/PV y Nodes, con salud y relaciones. Filtra por contexto, namespace, tipo y límite; omite valores de Secrets y mensajes de eventos |
| `cloud_resource_inventory` | Inventario en vivo de solo lectura para AWS, GCP o Vercel mediante un perfil seleccionado. Busca por texto, filtra por tipo y usa `nextCursor` para paginar el mismo snapshot de cinco minutos sin repetir el escaneo. AWS admite región y stacks de CloudFormation, verifica la cuenta con STS y acepta `scan_limit` (500 por defecto, hasta 5.000); la estimación indica el tope y si la fuente quedó truncada. Las consultas regionales AWS omiten la expansión lenta de políticas IAM (los previews de mapas conservan el análisis). No modifica recursos ni descarga código Lambda |
| `list_applications` | Aplicaciones de KUApps |
| `product_advisor` (Pro) | Hallazgos de producto de una aplicación de KUApps |
| `get_application` | Una KUA Application como la muestra KUApps: identidad, revisión, scopes con si este computador tiene un perfil verificado para cada uno (nunca el perfil), vistas de arquitectura, recursos contados por estado de señales, relaciones por estado y advertencias |
| `list_application_resources` | Sus recursos: identidad portable, scope del provider, fuentes, estado de señales (`current`, `stale`, `partial`, `no_data`, `disabled`, `error`, `no_connection`, `unsupported`) con la hora de los últimos datos, y relaciones. Filtros `state` y `provider`; como máximo 500 (100 por defecto), con `truncated` |
| `search_resources` | Lo que tiene una cuenta AWS, un proyecto GCP o un contexto Kubernetes, para asociarlo: por tipo, texto, ARN (AWS) o nombre completo (GCP). AWS: EC2, EBS, S3, DynamoDB, SQS, SNS, SES, Glue, Step Functions, load balancers y target groups, Route 53, CloudFront, RDS, API Gateway, EKS, ECS, EventBridge, Lambda. GCP: VMs, discos, GKE, Cloud SQL, buckets, Pub/Sub, Cloud Run, Functions, Firestore, Memorystore, Workflows, Scheduler, Tasks, BigQuery. Kubernetes: workloads, CronJobs, Jobs, Services, Ingresses, PVCs, PVs (con su volumen EBS o disco) y nodos (con su instancia). Cada item trae la entrada exacta `attach`. Solo List/Describe, sin costo |
| `recommend_application_resources` | Qué más pertenece a una aplicación, con evidencia y confianza: definiciones de Step Functions, entorno de Lambdas, target groups de load balancers, volúmenes de EC2 y, en Kubernetes, el clúster EKS, las instancias de los nodos y workload → PVC → PV → volumen. Los volúmenes liberados se marcan para revisar. No asocia nada |
| `preview_application_change` | Qué haría un cambio en una KUA Application, como un plan por aprobar |
| `apply_application_change` | Aplica un plan aprobado (requiere Permitir que agentes cambien KUApps) |
| `get_application_change` | El resultado de un plan, si se perdió la respuesta |
| `get_architecture_graph` | Una vista de arquitectura de la aplicación (por defecto la primera): nodos, nodos ocultos, relaciones con estado, confianza, decisión humana y tipos de evidencia. Es la vista guardada en su revisión, no una lectura en vivo |

Las herramientas del Advisor y de logs aceptan `format` (`markdown` por defecto, o `json` para los datos crudos) y `lang` (`en` o `es`). `profile` acepta el id o el nombre de un perfil de KUA, o el nombre de un perfil de la CLI de AWS o de una configuración de gcloud de este equipo (por ejemplo `prod`), así el agente puede trabajar antes de agregar el perfil a KUA. Se puede omitir cuando hay un solo perfil de ese proveedor.

### Apagar los agentes

**Acceso de agentes de IA (MCP)** enciende o apaga los agentes en este equipo, desde el icono de KUA en la bandeja o **Conectar un agente IA**. Está encendido por defecto. Apagado, KUA rechaza toda petición del servidor MCP (`AGENTS_DISABLED`, salvo el descubrimiento por `/api/health`) y el agente te dice dónde volver a encenderlo. El interruptor se guarda en este equipo y un agente no puede cambiarlo. El panel de la bandeja también muestra cuándo llegó la última petición de un agente.

### Cambiar KUApps desde un agente

Un agente puede cambiar una KUA Application en dos pasos, y solo mientras lo permitas: **Conectar un agente IA → Permitir que agentes cambien KUApps** (apagado por defecto, guardado en este computador). Apagado, los agentes igual pueden leer y previsualizar.

1. `preview_application_change` dice qué cambiaría y devuelve un `planId` válido por 15 minutos. No cambia nada.
2. Apruebas la vista previa en el agente. Después `apply_application_change` ejecuta ese plan con `confirm: true`.

| Operación | Datos | Lo que nunca hace |
| --- | --- | --- |
| `application.create` | `name`, `environment`, `team`, `scopes` | crear recursos en la nube |
| `application.update` | `name`, `environment`, `team` | |
| `resources.attach` | `resources[]` con `provider`, `type`, `key`, `name` y su scope: un ARN, o `scopeId` y `location`; `kubeContext` en Kubernetes. Solo un nombre se rechaza | activar la recolección |
| `resources.detach` | `resourceIds[]` (de `list_application_resources`) | borrar el recurso en la nube |
| `view.link` / `view.unlink` | `projectId` | borrar la vista |
| `scopes.add` / `scopes.remove` | `provider`, `scopeId`, `location` (o `scopeKey` para quitar); quitar avisa cuántos recursos dejan de recolectarse | |
| `resource.update` | `resourceId`, `enabled`, `name`, `service`, `logGroup`; activar muestra su costo de recolección | |
| `thresholds.update` | `thresholds` (tasa de error, duración, 5xx y latencia de load balancer, pods listos, reinicios, firmas recurrentes) | |
| `collection.update` | `pollingEnabled`: encendido programa la recolección cada 30 minutos; la vista previa muestra las llamadas y los USD estimados por ejecución y por mes | recolectar antes de que apruebes |
| `collection.run` | nada: recolecta una vez ahora; la vista previa muestra el costo de una ejecución | |
| `recommendations.dismiss` | `identityKeys[]` de `recommend_application_resources` | |

Los costos de recolección se estiman a precio de lista: CloudWatch `GetMetricData` USD 0,01 por cada 1.000 métricas y, para logs de Lambda, `FilterLogEvents` (sin cargo por petición; transferencia de datos USD 0,09 por GB después de 100 GB gratis al mes). Las señales de GCP usan la API de lectura de Cloud Monitoring: USD 0,50 por millón de series temporales devueltas después del primer millón gratis por cuenta de facturación al mes (una serie por métrica y ejecución). Las ejecuciones de Glue y la recolección de Kubernetes no tienen costo cloud.

- **Las vistas previas desactualizadas se rechazan.** Si la aplicación cambió después de la vista previa, aplicar responde `409 REVISION_CONFLICT` con la revisión actual y no escribe nada: vuelve a previsualizar.
- **Un plan, una escritura.** Se aplica el plan tal cual; el agente no puede cambiarlo entre medio. Aplicar el mismo `planId` otra vez devuelve el resultado registrado. Si se pierde una respuesta, `get_application_change` dice si se aplicó.
- **Los resultados parciales son explícitos.** Cada recurso asociado o desvinculado tiene su propio resultado; un plan donde algunos fallaron queda `partial`.
- **Auditado.** Cada aplicación de un plan queda en el registro de auditoría con el cliente (`mcp`), la aplicación, la operación, el plan y las revisiones antes y después, sin datos de los recursos ni perfiles.
- No hay herramientas para borrar aplicaciones ni infraestructura.

### Configuración desde la app

Haz clic en el ícono de **enchufe** junto a "Copiar para agente IA" (en cualquier Advisor o en las recomendaciones de logs) para abrir **Conectar agentes IA**:

- **Instalar en Claude Code / Instalar en Codex** agrega el servidor al agente por ti (alcance de usuario, reemplazando una entrada `kua` anterior). Necesita el comando `claude` o `codex` en el PATH de este equipo; si no está, ejecuta el comando que se muestra en la terminal donde usas el agente.
- **Verificar conexión** arranca el servidor tal como lo hará el agente y comprueba que llega a este KUA: muestra cuántas herramientas y perfiles ve, o qué falla (KUA cerrado, otro KUA abierto, el servidor no arranca).
- La configuración para Claude Code, Codex CLI, clientes JSON (`.mcp.json`, Cursor, VS Code) y el `config.toml` de Codex queda lista para copiar, con las rutas de tu instalación. Las rutas de Windows usan barras normales, así sobreviven al pegarlas en bash, PowerShell o cmd.

Con la app instalada, el servidor corre con el ejecutable de KuaDashboard en modo Node (`ELECTRON_RUN_AS_NODE=1`), así que no necesitas Node.js. Si mueves o reinstalas KUA, vuelve a instalar o copiar la configuración. Las secciones siguientes muestran la configuración desde una copia del repositorio.

### Cómo encuentra a KUA

El servidor encuentra solo el KUA que está corriendo, en cualquier puerto: la app instalada (`7190`), desarrollo (`7192`) u otro. Cada KUA anota dónde escucha en `~/.kuadashboard/run/` mientras corre, y el servidor toma el más reciente que responde. Si KUA está cerrado, se le avisa al agente al conectarse, y el servidor vuelve a buscar en la siguiente llamada: basta con abrir KUA después.

Define `KUA_URL` solo para apuntar el servidor a un KUA concreto (por ejemplo, cuando hay dos abiertos).

### Requisitos (desde el repositorio)

- Node.js 18 o superior.
- Una copia del repositorio de KUA (el servidor es `mcp/server.mjs`; no tiene dependencias que instalar).
- KuaDashboard abierto.

### Claude Code

La forma más simple es el plugin de KUA: **Instalar en Claude Code** en **Conectar un agente de IA** lo instala desde este computador, sin descargar nada (KUA mantiene un marketplace local con el plugin de su propia versión en `~/.kuadashboard/claude-plugin`; un Claude Code sin plugins recibe solo el servidor MCP). El plugin agrega el servidor MCP de KUA y una skill `kua` que le dice a Claude cómo trabajar con KUA: empezar por el Advisor y la inteligencia de logs, verificar el estado actual antes de cambiar nada, mostrar el costo y preguntar antes de operaciones con cargo o destructivas, y nunca copiar secretos ni logs crudos al repositorio.

Desde el propio Claude Code, el mismo plugin se instala desde GitHub:

```text
/plugin install kua --marketplace lnavarrocarter/kuadashboard
```

En Claude Code anterior a 2.1.275, agrega primero el marketplace con `/plugin marketplace add lnavarrocarter/kuadashboard` y luego `/plugin install kua@kuadashboard`. El plugin necesita Node.js en el PATH. Inicia el servidor MCP del KUA instalado en este computador: cada KUA registra cómo iniciarlo en `~/.kuadashboard/run/mcp-launch.json` (la app instalada gana sobre un KUA ejecutado desde el repositorio), así el servidor siempre coincide con tu versión de KUA. Si KUA nunca se ejecutó aquí, el servidor responde sin herramientas y le dice a Claude que instale y abra KUA. Verifícalo con `/mcp`: el servidor es `plugin:kua:kua`.

Sin el plugin, agrega el servidor a mano:

```bash
claude mcp add kua --scope user -- node /ruta/a/kuadashboard/mcp/server.mjs
```

O, para compartirlo con un proyecto, agrégalo a `.mcp.json` en la raíz del proyecto:

```json
{
  "mcpServers": {
    "kua": {
      "command": "node",
      "args": ["/ruta/a/kuadashboard/mcp/server.mjs"]
    }
  }
}
```

Compruébalo con `/mcp` dentro de Claude Code.

### Codex CLI

```bash
codex mcp add kua -- node /ruta/a/kuadashboard/mcp/server.mjs
```

O agrégalo a `~/.codex/config.toml`:

```toml
[mcp_servers.kua]
command = "node"
args = ["/ruta/a/kuadashboard/mcp/server.mjs"]
```

### VS Code

La [extensión de KUA para VS Code](./vscode) registra el servidor MCP de KUA para el chat del editor, sin configurar nada. Sin la extensión, agrega la entrada `kua` a `.vscode/mcp.json` con el comando de abajo.

### Otros clientes

Cualquier cliente que ejecute servidores MCP locales por stdio (Cursor, VS Code, Windsurf…) usa el mismo comando: `node /ruta/a/kuadashboard/mcp/server.mjs`.

ChatGPT (web y escritorio) solo se conecta a servidores MCP remotos por HTTPS, lo que implicaría exponer KUA a internet. Ahí usa el brief copiado.

### Problemas comunes

Empieza por **Verificar conexión** en Conectar agentes IA: nombra el problema. Dentro del agente, `/mcp` muestra el servidor y su estado.

| Lo que ves | Qué hacer |
| --- | --- |
| `Connection closed` al iniciar el agente | El comando no arrancó. En Windows solía ser una ruta pegada que perdió sus barras invertidas (`C:Users…`): vuelve a instalar con el botón o vuelve a copiar la configuración (ahora las rutas usan barras normales). |
| "KUA is not running at …" | Abre KuaDashboard. El servidor vuelve a buscar en la siguiente llamada; no hace falta reiniciar. |
| "Hay otro KUA abierto en …" (al verificar) | Hay dos KUA abiertos (por ejemplo, la app instalada y desarrollo) y el servidor lee el más reciente. Cierra uno, o define `KUA_URL` con el que quieres. |
| "KUA has no AWS/GCP profile" | Pasa `profile` con el nombre de un perfil de la CLI de AWS o de una configuración de gcloud de este equipo (el error los lista), o agrega el perfil en KUA con el ícono de llave de la barra superior (Env Manager). |
| "This MCP server is X" después de actualizar KUA | El agente sigue usando el servidor de la versión anterior: abre una nueva sesión del agente. |

### Ejemplos de prompts

- "Usa KUA para leer el Advisor de AWS del perfil prod y corrige los hallazgos altos en nuestro Terraform."
- "Lee la inteligencia de logs de /aws/lambda/orders en KUA, encuentra el código que lanza esos errores y propón una corrección."
- "Revisa el Advisor de Kubernetes del namespace shop y actualiza el chart de Helm para agregar requests, limits y probes."
- "Lee la aplicación Checkout en KUA y dime qué recursos tienen señales desactualizadas o sin datos."

## Privacidad

- Los briefs y las respuestas del MCP solo contienen lo que KUA ya muestra en pantalla.
- KUA sanitiza las muestras de logs antes de guardarlas; los valores sensibles se cuentan por tipo, nunca se copian.
- Las credenciales de los perfiles nunca salen de KUA: `list_profiles` devuelve solo id, nombre y proveedor.
- Las herramientas de KUA Application leen la aplicación con el mismo servicio de KUApps que la UI. Un nombre compartido por varias aplicaciones necesita el id, y una vista solo se entrega a través de la aplicación a la que pertenece. Indican qué scopes puede leer este computador, no qué perfil llega a ellos.
- Una vez que el brief llega a un agente, lo procesa el proveedor de ese agente según sus propios términos.
