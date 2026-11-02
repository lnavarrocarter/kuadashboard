---
title: Inventario de Proxmox VE
description: Inventario de solo lectura de clústeres y nodos de Proxmox VE en KUA, con un API token y un certificado TLS fijado.
---

# Proxmox VE

::: info Próxima versión
Proxmox VE llega con la próxima versión de KUA después de la 2.0.0. Mientras tanto, ejecuta KUA desde el repositorio (`main`) para probarlo.
:::


KUA lee un clúster de Proxmox VE o un nodo único y lo muestra en la pestaña **Proxmox**: quorum, nodos, VMs QEMU y contenedores LXC, storage, jobs de backup y tareas recientes. Solo lee: nada cambia en Proxmox, y las lecturas van a la API de Proxmox de tu red, sin costo de nube.

## Activar el plugin

Proxmox es un plugin first-party, desactivado por defecto. Abre **Plugins/Conexiones** (icono de enchufe en la barra de herramientas) y activa **Proxmox VE**; la pestaña **Proxmox** aparece en la barra superior.

## Crear un API token de solo lectura

1. En Proxmox, crea un usuario para KUA (por ejemplo `kua@pve`) y dale el rol **PVEAuditor** en `/`.
2. En **Datacenter → Permissions → API Tokens**, agrega un token para ese usuario con **Privilege Separation** activada y dale también el rol **PVEAuditor** al token.
3. Copia el id del token (`kua@pve!readonly`) y su secreto: Proxmox muestra el secreto una sola vez.

Un token de `root@pam`, o uno sin privilege separation, funciona, pero puede hacer mucho más de lo que KUA necesita.

## Agregar la conexión

En la pestaña **Proxmox**, haz clic en **+** (o usa el Env Manager y elige **Proxmox VE**) y completa:

| Campo | Valor |
|---|---|
| `PROXMOX_URL` | `https://pve.example.lan:8006` (solo https, sin ruta) |
| `PROXMOX_TOKEN_ID` | `kua@pve!readonly` |
| `PROXMOX_TOKEN_SECRET` | el secreto del token |

Luego elige cómo se verifica el certificado del servidor. KUA nunca desactiva la verificación TLS:

- **Fijar certificado** (autofirmado, lo habitual en Proxmox): haz clic en **Leer el certificado del servidor**. KUA se conecta sin enviar credenciales y muestra el fingerprint SHA-256. Compáralo con el de Proxmox (nodo → **Sistema → Certificados**) y haz clic en **Fijar este fingerprint**. Si el certificado cambia, KUA se niega a conectar y muestra el nuevo fingerprint.
- **CA propia**: pega la CA del clúster (`/etc/pve/pve-root-ca.pem`) o tu propia CA en PEM.
- **Certificado confiable**: para un certificado emitido por una CA en la que este computador ya confía (ACME/Let's Encrypt).

El secreto se guarda en el almacén de credenciales como los demás perfiles y nunca aparece en ids de scope, historial, logs ni exports.

## Qué ves

- **Overview**: quorum, nodos en línea, VMs, contenedores, guests en ejecución, storage sobre 85 %, guests sin job de backup y tareas fallidas en las últimas 24 h.
- Tablas de **VMs y contenedores**, **Nodos**, **Storage**, **Jobs de backup** y **Tareas recientes**.

Una sección que el token no puede leer lo dice ("no disponible") en vez de mostrar cero, y el resto se sigue mostrando. El inventario se guarda 30 segundos; **Actualizar** lo vuelve a leer.

## Architecture y KUApps

Con un perfil de Proxmox activo, **Agregar recursos → Proxmox VE** en un proyecto de Architecture muestra una vista previa de los nodos, VMs, contenedores y storage del clúster y agrega los que elijas, cada VM y contenedor corriendo en su nodo. Una sola lectura del inventario en tu red, sin costo cloud; las plantillas quedan fuera.

Los recursos agregados al mapa de una KUA Application, o asociados en KUApps, pertenecen al scope `proxmox:<clúster>` (el nombre del nodo si es uno solo), que KUApps vincula a un perfil de Proxmox y verifica leyendo el nombre del clúster. Forman parte de la topología de la aplicación; KUA todavía no recolecta métricas de ellos, así que se muestran como **Sin métricas de KUA** en lugar de "sin datos".
