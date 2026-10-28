---
title: "Dashboard de Vercel para escritorio — proyectos, deployments y logs"
description: "KUA es un dashboard de Vercel de escritorio, gratuito y open source: proyectos, deployments, logs de build, dominios, nombres de variables de entorno y funciones de cada team, junto a tu AWS, Google Cloud y Kubernetes."
schema: app
faq:
  - q: "¿KUA es un dashboard de Vercel?"
    a: "Sí. KUA muestra tus proyectos, deployments, logs de build, dominios, nombres de variables de entorno y funciones de Vercel en una app de escritorio, para cada team que conectes, junto a tus otras nubes."
  - q: "¿Puedo hacer redeploy o promote desde KUA?"
    a: "Sí. Redeploy, promote y cancel están en cada deployment, y KUA te pide confirmar cada uno antes de ejecutarlo."
  - q: "¿KUA está afiliado a Vercel?"
    a: "No. KUA es un proyecto independiente, gratuito y open source (licencia MIT) que usa la API REST pública de Vercel."
---

# Un dashboard de Vercel en tu escritorio, junto al resto de tu stack

Tu frontend está en Vercel, pero su API, sus colas y sus bases de datos viven en otro lado. KUA es un **dashboard de Vercel** gratuito y open source para tu escritorio que muestra tus proyectos y deployments de Vercel de cada team en la misma app que tus cuentas de AWS, proyectos de Google Cloud y clústeres de Kubernetes.

## Tus proyectos y deployments de Vercel

- **Proyectos:** cada proyecto con su framework, el estado de su último deployment y su URL de producción.
- **Deployments:** por proyecto, filtrados por production o preview, con redeploy, promote y cancel (cada uno confirmado antes).
- **Logs de build:** en tiempo real, con auto-scroll.
- **Dominios:** dominios personalizados, estado de verificación DNS y mapeos de ramas git.
- **Variables de entorno:** sus nombres y destinos por proyecto; los valores nunca se muestran.
- **Funciones:** las funciones serverless y edge de cualquier deployment.

## Más allá del dashboard de Vercel

- **Varios teams a la vez:** un perfil por team o cuenta personal, conectado con OAuth en un clic en la app de escritorio o con un token.
- **Advisor para Vercel:** hallazgos de buenas prácticas para tu team y tus proyectos.
- **Logs con inteligencia:** los logs de Vercel se suman a las firmas de errores recurrentes que KUA encuentra en tus nubes.
- **KUA Applications:** un proyecto de Vercel puede pertenecer a una aplicación junto con los recursos de AWS, GCP y Kubernetes que tiene detrás.

## Lecturas gratis, credenciales locales

KUA lee la API REST de Vercel con el token de cada perfil, que Vercel no cobra. Los tokens quedan cifrados en tu computador.

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Sigue leyendo

- [Vercel en detalle](/es/features/vercel)
- [Dashboard multi-cloud](/es/multi-cloud-dashboard)
- [Dashboard de AWS](/es/aws-dashboard)
- [Advisor](/es/features/advisor)

<small>Kubernetes es una marca registrada de The Linux Foundation. AWS, Google Cloud, Vercel, Lens y k9s son marcas de sus respectivos dueños. KUA es un proyecto open source independiente, sin afiliación ni respaldo de ellos.</small>
