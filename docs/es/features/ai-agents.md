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

Todas son de solo lectura.

| Herramienta | Qué devuelve |
| --- | --- |
| `list_profiles` | Perfiles de AWS, GCP y Vercel (id, nombre, proveedor). Nunca devuelve credenciales |
| `aws_advisor` (Pro) | Hallazgos del Advisor de AWS para un perfil (caché de 15 min; `refresh` vuelve a analizar con APIs gratuitas) |
| `gcp_advisor` (Pro) | Hallazgos del Advisor de GCP a partir del último overview guardado |
| `kubernetes_advisor` (Pro) | Hallazgos del Advisor de Kubernetes para el contexto actual (`namespace` opcional) |
| `list_log_groups` | Log groups de CloudWatch en la caché de KUA para un perfil |
| `log_intelligence` | Brief de un log group en caché: tasas de error, anomalías, errores parecidos, firmas, recomendaciones, consultas |
| `search_logs` | Errores recurrentes de los log groups en caché buscados por significado, en cualquier idioma (requiere el ML local activado en KUA); `provider: "kubernetes"` busca en los workloads de Kubernetes en caché |
| `list_kube_log_workloads` | Workloads de Kubernetes cuyos logs de pods guarda KUA para el contexto actual |
| `kube_log_intelligence` | Brief de un workload de Kubernetes en caché: tasas de error, anomalías, errores parecidos, recomendaciones, consultas |
| `list_applications` | Aplicaciones de KUApps |
| `product_advisor` (Pro) | Hallazgos de producto de una aplicación de KUApps |

Las herramientas del Advisor y de logs aceptan `format` (`markdown` por defecto, o `json` para los datos crudos) y `lang` (`en` o `es`). `profile` acepta el id o el nombre del perfil y se puede omitir cuando hay un solo perfil de ese proveedor.

### Configuración desde la app

Haz clic en el ícono de **enchufe** junto a "Copiar para agente IA" (en cualquier Advisor o en las recomendaciones de logs) para abrir **Conectar agentes IA**. Muestra la configuración exacta para Claude Code, Codex CLI, clientes JSON (`.mcp.json`, Cursor, VS Code) y el `config.toml` de Codex, con las rutas de tu instalación, lista para copiar.

Con la app instalada, el servidor corre con el ejecutable de KuaDashboard en modo Node (`ELECTRON_RUN_AS_NODE=1`), así que no necesitas Node.js. Si mueves o reinstalas KUA, vuelve a copiar la configuración. Las secciones siguientes muestran la configuración desde una copia del repositorio.

### Requisitos (desde el repositorio)

- Node.js 18 o superior.
- Una copia del repositorio de KUA (el servidor es `mcp/server.mjs`; no tiene dependencias que instalar).
- KuaDashboard abierto. El servidor lee `http://localhost:7190` por defecto; define `KUA_URL` si KUA corre en otra dirección (por ejemplo `http://localhost:7192` con `npm run dev`).

### Claude Code

```bash
claude mcp add kua --scope user -- node /ruta/a/kuadashboard/mcp/server.mjs
```

O, para compartirlo con un proyecto, agrégalo a `.mcp.json` en la raíz del proyecto:

```json
{
  "mcpServers": {
    "kua": {
      "command": "node",
      "args": ["/ruta/a/kuadashboard/mcp/server.mjs"],
      "env": { "KUA_URL": "http://localhost:7190" }
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
env = { KUA_URL = "http://localhost:7190" }
```

### Otros clientes

Cualquier cliente que ejecute servidores MCP locales por stdio (Cursor, VS Code, Windsurf…) usa el mismo comando: `node /ruta/a/kuadashboard/mcp/server.mjs`.

ChatGPT (web y escritorio) solo se conecta a servidores MCP remotos por HTTPS, lo que implicaría exponer KUA a internet. Ahí usa el brief copiado.

### Ejemplos de prompts

- "Usa KUA para leer el Advisor de AWS del perfil prod y corrige los hallazgos altos en nuestro Terraform."
- "Lee la inteligencia de logs de /aws/lambda/orders en KUA, encuentra el código que lanza esos errores y propón una corrección."
- "Revisa el Advisor de Kubernetes del namespace shop y actualiza el chart de Helm para agregar requests, limits y probes."

## Privacidad

- Los briefs y las respuestas del MCP solo contienen lo que KUA ya muestra en pantalla.
- KUA sanitiza las muestras de logs antes de guardarlas; los valores sensibles se cuentan por tipo, nunca se copian.
- Las credenciales de los perfiles nunca salen de KUA: `list_profiles` devuelve solo id, nombre y proveedor.
- Una vez que el brief llega a un agente, lo procesa el proveedor de ese agente según sus propios términos.
