---
layout: home
title: KUA — Dashboard de Kubernetes y Multi-Cloud Open Source para Escritorio
titleTemplate: false
description: Dashboard open source para gestionar Kubernetes, AWS, GCP, Vercel, Helm, logs y operaciones de infraestructura desde una sola interfaz.

hero:
  name: KUA
  text: El dashboard de escritorio para Kubernetes y multi-cloud
  tagline: "Know Unified Administration: tus clústeres de Kubernetes, AWS, GCP y Vercel en una sola app open source para Windows, macOS y Linux."
  actions:
    - theme: brand
      text: Empezar
      link: /es/guide/getting-started
    - theme: alt
      text: Descargar App
      link: /es/download
    - theme: alt
      text: GitHub
      link: https://github.com/lnavarrocarter/kuadashboard
    - theme: alt
      text: 💖 Patrocinar
      link: /es/sponsor

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

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>
