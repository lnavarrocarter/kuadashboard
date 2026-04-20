# Port Forwarding

KuaDashboard provides a visual port-forward manager built on top of the Kubernetes port-forward API.

## Quick Start

1. Click on a **Service** in the resource table
2. Click the **Port Forward** action button
3. Choose local port and target port
4. The forward starts immediately

## Port Forward Panel

Toggle the panel with the **Ports** button in the header. The panel shows all active forwards:

- **Service/Pod name** and namespace
- **Local port** → **Remote port** mapping
- **Status** indicator (active/error)
- **Stop** button to terminate individual forwards

## Features

- **Persistent sessions** — Active port forwards survive page refreshes (stored in localStorage)
- **Auto-reconnect** — Automatically restores forwards on app startup
- **Manual mode** — Create forwards by specifying namespace, resource, and ports manually
- **Multiple forwards** — Run as many simultaneous forwards as needed
- **Badge counter** — Header button shows the number of active forwards

## Manual Port Forward

Click the **Ports** button, then **Add Manual** to specify:
- Namespace
- Resource type (Service or Pod)
- Resource name
- Local port
- Remote port
