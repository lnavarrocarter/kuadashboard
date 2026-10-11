---
layout: home
title: KUA — Dashboard de Kubernetes y Multi-Cloud Open Source para Escritorio
titleTemplate: false
description: Dashboard open source para gestionar Kubernetes, AWS, GCP, Vercel, Helm, logs y operaciones de infraestructura desde una sola interfaz.

hero:
  name: KUA
  text: Kubernetes y varias nubes en una sola app
  tagline: "Sin saltar entre consolas y terminales. Tus clústeres de Kubernetes, AWS, GCP y Vercel en una app de escritorio gratuita y open source para Windows, macOS y Linux."
  image:
    src: /screenshots/dashboard-main.png
    alt: Dashboard de KUA con la vista general de un clúster de Kubernetes
  actions:
    - theme: brand
      text: Descargar
      link: /es/download
    - theme: alt
      text: Empezar
      link: /es/guide/getting-started
    - theme: alt
      text: ⭐ Dar una estrella en GitHub
      link: https://github.com/lnavarrocarter/kuadashboard

features:
  - icon: ☁️
    title: Multi-Cloud Unificado
    details: AWS (EC2, ECS, EKS, Lambda, S3, DynamoDB, Secrets Manager y más) + GCP (Cloud Run, GKE, SQL, Storage) en una sola interfaz con credenciales persistentes.
  - icon: ☸️
    title: Gestión de Kubernetes
    details: Cobertura amplia de recursos con tablas multi-seleccion, eliminacion masiva, ConfigMaps/Secrets/envs editables, import kubeconfig, metricas, eventos y operaciones con un clic.
  - icon: 📺
    title: Logs en Vivo & Shell
    details: Logs en tiempo real para pods y workloads, búsqueda/filtros por fecha, descarga, exec en pods, shell local y sesiones EC2 SSH/RDP persistentes.
  - icon: 🔐
    title: Env Manager
    details: Perfiles de credenciales cifradas (AES-256) para AWS, GCP y genéricos. Import/export de .env. Integración con Secrets Manager.
  - icon: 🔌
    title: Port Forwarding
    details: Tuneles confiables a Services y Pods con resolucion del pod objetivo, sesiones persistentes, auto-reconexion y panel visual integrado.
  - icon: 📦
    title: Operaciones Helm
    details: Busca charts, instalalos en el cluster activo, revisa releases y usa un preset de metrics-server para clusters locales o self-signed.
  - icon: 🖥️
    title: App de Escritorio
    details: Experiencia nativa en Windows, macOS y Linux vía Electron. Backend integrado, auto-update y arranque instantáneo.

faq:
  - q: "¿Qué es KUA?"
    a: "KUA (KuaDashboard) es un dashboard de escritorio gratuito y open source para Kubernetes, AWS, GCP y Vercel. Muestra clústeres, pods, deployments, logs, shells, port forwards, releases de Helm, logs de CloudWatch y costos de la nube en una sola app para Windows, macOS y Linux."
  - q: "¿KUA es una alternativa a Lens o k9s?"
    a: "Sí. Como Lens o k9s, KUA administra clústeres de Kubernetes desde tu kubeconfig: workloads, logs, exec en pods, port forwarding, eventos, métricas y Helm. Además administra recursos de AWS, GCP y Vercel en la misma ventana."
  - q: "¿KUA funciona con EKS, GKE y AKS?"
    a: "Sí. KUA funciona con cualquier clúster de tu kubeconfig, incluidos Amazon EKS, Google GKE, Azure AKS, k3s, kind y minikube, y puede importar kubeconfigs de EKS y GKE desde tus perfiles cloud."
  - q: "¿KUA es gratis?"
    a: "Sí. KUA es open source con licencia MIT y todas las funciones locales son gratuitas. Los planes Pro y Team, opcionales, agregan respaldos en la nube, sincronización entre equipos, el Advisor y trabajo en equipo."
  - q: "¿Mis credenciales salen de mi equipo?"
    a: "No. Los kubeconfigs, credenciales cloud, perfiles y logs se quedan en tu equipo, cifrados con el llavero del sistema operativo. KUA habla directamente con tus clústeres y las APIs de la nube."
---

## Un dashboard de Kubernetes y la nube en tu escritorio

KUA reúne tus **clústeres de Kubernetes**, tus cuentas de **AWS** y **GCP** y tus proyectos de **Vercel** en una sola app de escritorio. Explora pods, deployments y services, lee logs en vivo e históricos, abre una shell en un pod o una instancia EC2, redirige puertos, instala charts de Helm, busca en los logs de CloudWatch, encuentra errores recurrentes y ve cuánto cuestan tus llamadas a las APIs de la nube, sin saltar entre la consola de AWS, la de GCP, `kubectl` y una terminal.

- **Kubernetes:** kubeconfig multi-clúster, workloads, ConfigMaps y Secrets, logs, exec, port forwarding, eventos, métricas, Helm.
- **AWS:** EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, Secrets Manager, CloudWatch Logs y Logs Insights, con permisos IAM mínimos.
- **GCP:** Cloud Run, GKE, Cloud SQL, Cloud Storage.
- **Local y privado:** las credenciales quedan cifradas en tu equipo; la app es open source.

<script setup>
import { withBase } from 'vitepress'
</script>

## Míralo en acción

<div class="home-shots">
  <figure>
    <img :src="withBase('/screenshots/dashboard-pods.png')" alt="Pods de un clúster de Kubernetes con estado, reinicios y antigüedad" loading="lazy" />
    <figcaption><strong>Pods, logs y shell.</strong> Inspecciona workloads, lee logs en vivo y abre una shell en un pod.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/dashboard-deployments.png')" alt="Lista de deployments con réplicas e imágenes" loading="lazy" />
    <figcaption><strong>Deployments.</strong> Escala, reinicia y edita workloads sin escribir comandos <code>kubectl</code>.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/dashboard-services.png')" alt="Lista de services con tipo, puertos e IPs del clúster" loading="lazy" />
    <figcaption><strong>Services y port forwarding.</strong> Abre un túnel a un Service o Pod con un clic.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/dashboard-nodes.png')" alt="Vista de nodos con capacidad y condiciones" loading="lazy" />
    <figcaption><strong>Nodos y métricas.</strong> Revisa capacidad, condiciones y uso en tus clústeres.</figcaption>
  </figure>
</div>

## Descarga KUA para tu sistema

<div class="home-download">
  <a class="home-os" :href="withBase('/es/download')">
    <span class="home-os-icon" aria-hidden="true">🪟</span>
    <strong>Windows</strong>
    <span>Windows 10 o superior · x64</span>
  </a>
  <a class="home-os" :href="withBase('/es/download')">
    <span class="home-os-icon" aria-hidden="true">🍎</span>
    <strong>macOS</strong>
    <span>macOS 12 o superior · Intel y Apple Silicon</span>
  </a>
  <a class="home-os" :href="withBase('/es/download')">
    <span class="home-os-icon" aria-hidden="true">🐧</span>
    <strong>Linux</strong>
    <span>Ubuntu 20.04+ / Debian 11+ · x64 · AppImage y .deb</span>
  </a>
</div>

Cada versión se compila en GitHub Actions e incluye un archivo `SHA256SUMS.txt`. [Ver todas las versiones y checksums](/es/download).

## Planes: gratis para empezar, Pro y Team cuando necesitas más

- **Free (USD 0):** todas las funciones locales, hasta 3 KUA Applications, caché de logs de 256 MB y refresco manual.
- **Pro (USD 9 al mes o USD 90 al año):** Advisor, agentes de IA por MCP, tareas programadas, KUA Applications ilimitadas, caché de logs de 2 GB y refresco automático cada 15 minutos o más.
- **Team (USD 29 al mes o USD 290 al año):** todo lo de Pro, refresco cada 1 minuto, caché de logs de 20 GB y hasta 10 miembros.

Los límites de Free aplican desde 2026-11-10.

[Comparar planes](/es/pricing) · [Descargar KUA](/es/download)

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## ¿Te gusta KUA? Dale una estrella

KUA es gratuito y se construye en abierto. Una estrella en GitHub es la forma más simple de ayudar a que otros ingenieros lo encuentren, y [patrocinar el proyecto](/es/sponsor) lo mantiene avanzando.

<div class="home-social">
  <a href="https://github.com/lnavarrocarter/kuadashboard"><img src="https://img.shields.io/github/stars/lnavarrocarter/kuadashboard?style=social" alt="Estrellas en GitHub" loading="lazy" /></a>
  <a href="https://github.com/lnavarrocarter/kuadashboard/releases"><img src="https://img.shields.io/github/v/release/lnavarrocarter/kuadashboard" alt="Última versión en GitHub" loading="lazy" /></a>
  <a href="https://github.com/lnavarrocarter/kuadashboard"><img src="https://img.shields.io/github/license/lnavarrocarter/kuadashboard" alt="Licencia MIT" loading="lazy" /></a>
</div>
## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>
