---
title: "Dashboard multi-cloud para AWS, Google Cloud, Vercel y Kubernetes"
description: "KUA es un dashboard multi-cloud gratuito y open source: AWS, Google Cloud, Vercel y Kubernetes en una app de escritorio, con Advisor, aplicaciones entre nubes, log intelligence y costos a la vista."
schema: app
faq:
  - q: "¿Qué es un dashboard multi-cloud?"
    a: "Un dashboard multi-cloud muestra los recursos de varios proveedores cloud en un solo lugar. KUA lo hace para AWS, Google Cloud, Vercel y Kubernetes desde una app de escritorio, para explorar, buscar logs y actuar en cada proveedor sin cambiar de consola."
  - q: "¿KUA envía mis datos cloud a un servidor?"
    a: "No. KUA corre en tu computador y llama directo a la API de cada proveedor con tus propios perfiles, que quedan cifrados en tu equipo. Una cuenta de KUA, opcional, solo guarda tu plan y, si los activas, respaldos y sincronización."
  - q: "¿El dashboard multi-cloud de KUA es gratis?"
    a: "Sí. KUA es open source con licencia MIT; todas las funciones locales para AWS, Google Cloud, Vercel y Kubernetes son gratuitas. Pro y Team agregan el Advisor, la actualización automática, agentes de IA por MCP y trabajo en equipo."
---

# Un dashboard multi-cloud para AWS, Google Cloud, Vercel y Kubernetes

La mayoría de los equipos usa más de una nube: un clúster EKS o GKE, funciones Lambda, servicios de Cloud Run, un frontend en Vercel. KUA es un **dashboard multi-cloud** que los reúne en una app de escritorio, con una sola forma de leerlos, buscar y corregir, para dejar de saltar entre la consola de AWS, la consola de Google Cloud, el dashboard de Vercel, `kubectl` y una terminal.

![Resumen del dashboard multi-cloud de KUA](/screenshots/dashboard-main.png)

## Cada proveedor, lado a lado

- **Kubernetes:** cada clúster de tu kubeconfig, con workloads, logs, shell, port forwarding y Helm.
- **AWS:** EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, API Gateway, CloudFormation, CloudWatch Logs y más, con SSO y credenciales temporales.
- **Google Cloud:** Cloud Run, GKE, Compute Engine, Cloud SQL, Cloud Storage, BigQuery, Pub/Sub y más, con tus configuraciones de gcloud o una service account.
- **Vercel:** proyectos, deployments, logs de build, dominios y nombres de variables de entorno, para cada team.

## Pensado para varias nubes, no solo para varias pestañas

- **KUA Applications:** un espacio de trabajo por aplicación que agrupa sus recursos entre nubes y clústeres, con el estado de sus señales, un mapa y las rutas entre ellos.
- **Advisor:** el mismo tipo de hallazgos de buenas prácticas para Kubernetes, AWS, GCP y Vercel, agrupados en seguridad, infraestructura, arquitectura y desarrollo.
- **Log intelligence:** firmas de errores recurrentes en logs de CloudWatch, Kubernetes, Cloud Logging y Vercel.
- **Costos a la vista:** cada lectura con costo dice cuánto cuesta antes de ejecutarse, y los costos de AWS vienen de Cost Explorer por perfil.
- **Un solo baúl de credenciales:** perfiles para cada cuenta, proyecto y team, cifrados en tu computador.

## Cada acción muestra su cuenta y región

Cada vista dice qué perfil, cuenta, proyecto, región o clúster está leyendo, y las escrituras confirman dónde van a actuar. Cambiar de nube nunca te deja adivinando en qué ambiente estás.

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Sigue leyendo

- [Dashboard de AWS](/es/aws-dashboard)
- [Una alternativa de escritorio a la consola de Google Cloud](/es/google-cloud-console-alternative)
- [Dashboard de Vercel](/es/vercel-dashboard)
- [Dashboard de Kubernetes](/es/kubernetes-dashboard)
- [Advisor](/es/features/advisor)

<small>Kubernetes es una marca registrada de The Linux Foundation. AWS, Google Cloud, Vercel, Lens y k9s son marcas de sus respectivos dueños. KUA es un proyecto open source independiente, sin afiliación ni respaldo de ellos.</small>
