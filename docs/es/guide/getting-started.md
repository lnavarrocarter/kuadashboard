# Primeros Pasos

**KUA (Know Unified Administration)** es una plataforma open source para centralizar la operación de infraestructura distribuida en AWS, GCP y Kubernetes. Construida con **Node.js + Express** y **Vue 3 + Vite + Pinia**, funciona como app web o app nativa de escritorio (Electron) en **Windows**, **macOS** y **Linux**.

![KUA Dashboard](/screenshots/dashboard-nodes.png)

## Requisitos Previos

- **Node.js** >= 16 (recomendado: 20+)
- **kubectl** configurado con un kubeconfig válido (`~/.kube/config`)
- Para funciones cloud: AWS CLI o GCP `gcloud` CLI configurados

## Inicio Rápido (Modo Web)

```bash
# Clonar el repositorio
git clone https://github.com/lnavarrocarter/kuadashboard.git
cd kuadashboard

# Instalar dependencias del backend
npm install

# Instalar dependencias del frontend
cd frontend && npm install && cd ..

# Iniciar el servidor
npm start
```

Abre [http://localhost:7190](http://localhost:7190) en tu navegador.

## Modo Desarrollo

Para hot-reload durante el desarrollo:

```bash
# Backend + Frontend dev servers (concurrente)
npm run dev:full
```

Esto inicia:
- **Backend** en `http://localhost:7190` (con nodemon auto-reload)
- **Frontend** Vite dev server en `http://localhost:7191` (con HMR)

## App de Escritorio (Electron)

```bash
# Modo desarrollo con Electron
npm run electron:dev

# Build para tu plataforma actual
npm run electron:build
```

Ver la [Guía Electron](/es/guide/electron) para detalles de builds multiplataforma.

## Siguientes Pasos

- [Instalación](/es/guide/installation) — Setup detallado y requisitos del sistema
- [Funcionalidades](/es/features/) — Explorar todas las capacidades
- [Arquitectura](/es/architecture/) — Entender la estructura del proyecto
