---
title: "Alternativa a la consola de Google Cloud para escritorio — dashboard de GCP"
description: "Administra Google Cloud desde una app de escritorio: KUA es un dashboard de GCP gratuito y open source para Cloud Run, GKE, Compute Engine, Cloud SQL, Cloud Storage, BigQuery, Pub/Sub y más, con tus configuraciones de gcloud."
schema: app
faq:
  - q: "¿KUA reemplaza la consola de Google Cloud?"
    a: "KUA cubre el trabajo diario en los servicios de esta página desde una app de escritorio y agrega un Advisor y vistas multi-cloud. Para los servicios que no cubre, o para facturación y configuración de la organización, sigues usando la consola de Google Cloud."
  - q: "¿Cómo se conecta KUA a Google Cloud?"
    a: "Con las configuraciones de gcloud que ya tienes en tu computador (Application Default Credentials) o con una llave de service account que KUA guarda cifrada. Llama directo a las APIs de Google Cloud, con los permisos de esa identidad."
  - q: "¿KUA está afiliado a Google?"
    a: "No. KUA es un proyecto independiente, gratuito y open source (licencia MIT). Usa las APIs públicas de Google Cloud."
---

# Una alternativa de escritorio a la consola de Google Cloud

La consola de Google Cloud es potente, pero cambiar de proyecto, esperar que carguen las páginas y perderse entre pestañas se acumula. KUA es un **dashboard de Google Cloud (GCP)** gratuito y open source para tu escritorio: lee tus proyectos con tus propias configuraciones de gcloud o una service account y muestra los servicios que usas a diario en una app rápida, junto a tus cuentas de AWS, teams de Vercel y clústeres de Kubernetes.

## Los servicios de Google Cloud que usas, en una app

- **Cómputo:** Cloud Run (con instancias mínimas), Cloud Run Jobs y sus ejecuciones, GKE y VMs de Compute Engine con inicio, detención y SSH sin configurar llaves.
- **Bases de datos:** Cloud SQL (iniciar y detener), Cloud Spanner y BigQuery con editor SQL, documentos de Firestore y Memorystore.
- **Almacenamiento:** un explorador de Cloud Storage con vista previa y descarga, y paquetes de Artifact Registry.
- **Serverless y mensajería:** Cloud Functions (invocar y logs), tópicos y suscripciones de Pub/Sub, Cloud Tasks, Cloud Scheduler y Workflows.
- **Seguridad y operación:** Secret Manager, Cloud KMS, service accounts, Cloud DNS, redes VPC, logs de Cloud Build, Cloud Monitoring y un panel de consultas de Cloud Logging.

## Lo que la consola no te da

- **Advisor para GCP:** hallazgos deterministas de buenas prácticas (seguridad, infraestructura, arquitectura, desarrollo) con los recursos afectados.
- **Lecturas honestas:** una lista que KUA no pudo leer dice por qué en vez de mostrar 0, y las respuestas tardías nunca caen en otro recurso.
- **Varios proyectos a la vez:** cada configuración de gcloud aparece como un perfil; cambia de proyecto sin volver a iniciar sesión.
- **Una app para todas las nubes:** la misma ventana administra AWS, Vercel y Kubernetes.

## Tus credenciales siguen siendo tuyas

KUA usa tus Application Default Credentials de gcloud o una llave de service account guardada cifrada en tu computador, y llama directo a las APIs de Google Cloud. Nada pasa por un servidor de KUA.

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Sigue leyendo

- [Google Cloud en detalle](/es/features/gcp)
- [Dashboard multi-cloud](/es/multi-cloud-dashboard)
- [Dashboard de Kubernetes para GKE](/es/kubernetes-dashboard)
- [Credenciales y perfiles](/es/guide/credentials)

<small>Kubernetes es una marca registrada de The Linux Foundation. AWS, Google Cloud, Vercel, Lens y k9s son marcas de sus respectivos dueños. KUA es un proyecto open source independiente, sin afiliación ni respaldo de ellos.</small>
