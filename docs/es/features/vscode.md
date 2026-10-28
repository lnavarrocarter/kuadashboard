---
title: KUA para VS Code
description: La extensión de KUA para VS Code muestra el KUA local en la barra de estado y le da al chat de IA del editor las herramientas MCP de KUA sin configurar nada.
---

# KUA para VS Code

::: info Próxima versión
La extensión de KUA para VS Code llega con la próxima versión de KUA después de la 2.0.0, que adjunta su `.vsix` a la release. Mientras tanto, constrúyela desde el repositorio con `npm ci && npm run package` en `vscode/`.
:::


La extensión de KUA trae tu KUA local a VS Code:

- **Barra de estado**: si KUA corre en este computador, su versión y plan, y si los agentes de IA están permitidos. Haz clic para ver los comandos.
- **Servidor MCP para el chat**: con KUA abierto, el chat del editor (Copilot en modo agente y cualquier cliente que use la API MCP de VS Code) obtiene las [herramientas](./ai-agents#herramientas) de KUA sin editar ningún archivo. La extensión inicia el servidor MCP del KUA que tienes instalado, así que ambos siempre tienen la misma versión. Con KUA cerrado, el servidor igual arranca y le dice al agente que abra KUA.
- **Vista de aplicaciones**: el icono de KUA en la barra de actividad lista tus KUA Applications con lo que requiere atención (el mismo texto que KUApps: umbrales superados, recursos que ya no existen, recolecciones fallidas), sus recursos con el estado de señales y el Advisor de producto. La aplicación de este workspace aparece primero y expandida: la configurada en `kua.application` (**Asociar este workspace a una KUA Application** en la vista), o la única cuyo repositorio de GitHub, configurado en KUA o declarado por sus workloads, coincide con el `origin` del workspace. Cada elemento tiene **Abrir en KUA** (esa aplicación y pestaña en KUA) y **Enviar al chat**, que le da al chat del editor el brief de KUA de un problema, un hallazgo del Advisor o el Advisor completo, sin credenciales ni logs crudos; en un editor sin chat el brief se copia. La vista se actualiza al enfocar la ventana, cuando KUA arranca o se detiene y con su botón de actualizar, y solo lee la API local de KUA.
- **KUA: Abrir dashboard** abre la app de escritorio (`kua://open`), o el navegador para un KUA ejecutado desde el repositorio. El ajuste `kua.openIn` elige `app` o `browser`.
- **KUA: Verificar conexión MCP** inicia el servidor como lo hace el chat e informa las herramientas y perfiles que alcanzó, o el error.
- **KUA: Agregar el servidor MCP a este workspace** escribe la entrada `kua` en `.vscode/mcp.json`, conservando los demás servidores y comentarios, para editores que leen ese archivo pero no la API de extensiones. Un archivo inválido no se sobrescribe.
- **KUA: Agregar el steering de KUA a este workspace para Kiro** escribe `.kiro/steering/kua.md` (ver [Kiro](#kiro)).

## Kiro

Kiro está construido sobre VS Code, así que la misma extensión se instala en Kiro desde el `.vsix` (u Open VSX). Kiro obtiene las herramientas de KUA desde su propio archivo MCP: usa **Instalar** en **Conectar un agente de IA → Kiro** de KUA, que sirve para el IDE de Kiro y para `kiro-cli`.

**KUA: Agregar el steering de KUA a este workspace para Kiro** agrega un [archivo de steering](https://kiro.dev/docs/steering/) que el agente de Kiro siempre lee: cómo trabajar con KUA, las mismas reglas que la skill `kua` del plugin de Claude Code. Partir del Advisor y de log intelligence, verificar el estado actual antes de cambiar infraestructura, mostrar el costo y preguntar antes de operaciones con costo o destructivas, cambiar KUA Applications solo con una vista previa que el usuario aprueba, y nunca copiar credenciales ni logs crudos al repositorio. Un `kua.md` que editaste solo se reemplaza si lo confirmas. Haz commit de él para que el Kiro de todo el equipo lo tenga.

Lo que Kiro lee a través de KUA queda en este computador: el inventario de KUA, los hallazgos del Advisor, log intelligence sobre logs en caché y las KUA Applications, por el servidor MCP local. Las credenciales cloud quedan en KUA.

Prompts para probar en Kiro:

- "Usa el Advisor de KUA para el perfil AWS de este proyecto y corrige los hallazgos que el Terraform de `infra/` pueda corregir. Muéstrame el diff."
- "¿Qué error recurrente creció más en los logs de `orders-api` esta semana? Encuentra de dónde viene en este repositorio."
- "¿Qué necesita atención en la KUA Application de este repositorio y qué puedo corregir desde el código?"

KUA todavía no se empaqueta como Power de Kiro: un Power lleva un comando MCP fijo, y el de KUA depende de dónde está instalado KUA en cada computador, lo que la propia instalación de KUA ya escribe.

## Instalar

Hasta que la extensión esté en el Marketplace y en Open VSX, instala el `.vsix` de la release: **Extensiones → … → Instalar desde VSIX…**. Necesita VS Code 1.101 o posterior para la integración con el chat.

KUA se encuentra solo, en cualquier puerto (igual que el servidor MCP). Configura `kua.url` (por ejemplo `http://localhost:7192`) para usar uno específico.

La extensión corre en el computador donde corre KUA, también cuando el editor está conectado a Remote SSH, WSL o un Dev Container.

## Privacidad

La extensión solo habla con el KUA de este computador (`127.0.0.1`) y no lee ni guarda credenciales de nube. Los agentes leen a través de KUA, cada cambio en KUA Applications se previsualiza y aprueba en KUA, y apagar los agentes en el panel de la bandeja los rechaza a todos.
