---
title: "Dashboard de Kubernetes para escritorio — gratis y open source"
description: "KUA es un dashboard de Kubernetes gratuito y open source para Windows, macOS y Linux: todos los clústeres de tu kubeconfig, workloads, logs, shell, port forwarding, Helm, YAML y métricas en una app."
schema: app
faq:
  - q: "¿KUA es un dashboard de Kubernetes?"
    a: "Sí. KUA es un dashboard de Kubernetes de escritorio: muestra los workloads, logs, eventos y métricas de cada clúster de tu kubeconfig y te deja entrar a pods, redirigir puertos, editar YAML y usar Helm, en Windows, macOS y Linux."
  - q: "¿Tengo que instalar algo en el clúster?"
    a: "No. A diferencia del Kubernetes Dashboard que se despliega en el clúster, KUA corre en tu computador y usa tu kubeconfig: no hay nada que desplegar ni token de service account que exponer. Las métricas necesitan metrics-server o Prometheus en el clúster, igual que kubectl top."
  - q: "¿El dashboard de Kubernetes de KUA es gratis?"
    a: "Sí. KUA es open source con licencia MIT y todas las funciones locales de Kubernetes son gratuitas. Los planes Pro y Team, opcionales, agregan el Advisor, la actualización automática de logs, agentes de IA por MCP y trabajo en equipo."
---

# Un dashboard de Kubernetes en tu escritorio

KUA es un **dashboard de Kubernetes** gratuito y open source que corre en tu computador. Lee los clústeres de tu kubeconfig (EKS, GKE, AKS, k3s, kind, minikube o los tuyos) y muestra sus workloads, logs y salud sin instalar nada en el clúster: no hay dashboard que desplegar, token que exponer ni puerto que abrir.

![Pods de un clúster de Kubernetes en el dashboard de KUA](/screenshots/dashboard-pods.png)

## Todo lo que haces con kubectl, en una ventana

- **Workloads y recursos:** Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingresses, ConfigMaps, Secrets, PVCs, HPAs, Nodes, Events y más, con filtros, selección múltiple y conteos "N de M".
- **Logs y shell:** logs en vivo de un pod o de un workload completo (todos sus contenedores), búsqueda, filtros por fecha y descarga, y una shell interactiva en cualquier contenedor.
- **Port forwarding:** túneles a Services y Pods que sobreviven a reinicios de pods y se reconectan solos.
- **YAML:** ver, editar, validar y aplicar cualquier recurso, con búsqueda y autocompletado.
- **Operaciones:** escalar, reiniciar, cordon, drain y eliminar, confirmando antes el clúster, el contexto y el namespace.
- **Helm:** buscar charts, instalar o actualizar releases y desinstalarlos.
- **Métricas:** CPU y memoria desde metrics-server, con Prometheus como respaldo; un uso sin muestras lo dice en vez de mostrar 0.

## Más que un explorador de clústeres

- **Ruta de diagnóstico:** un pod enlaza a sus logs actuales y anteriores, su ReplicaSet, Deployment, Node y Services; un Service dice por qué no tiene backends.
- **Advisor:** revisiones de buenas prácticas del clúster y sus workloads (contenedores privilegiados, ejecución como root, secretos en variables de entorno planas, sin requests ni límites de memoria, réplicas únicas, sin PodDisruptionBudget, crash loops y más), con los recursos afectados.
- **Log intelligence:** firmas de errores recurrentes en los pods de un workload, desde una caché local.
- **Multi-clúster:** cambia de contexto desde la barra superior e importa kubeconfigs de EKS y GKE desde tus perfiles cloud.

## Privado por diseño

Tu kubeconfig y tus credenciales quedan en tu computador, cifrados con el llavero del sistema operativo. KUA habla directo con la API de Kubernetes, con los permisos que ya tienes, y su API local solo escucha en 127.0.0.1.

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Sigue leyendo

- [Kubernetes en detalle](/es/features/kubernetes)
- [Port forwarding](/es/features/port-forwarding)
- [Una alternativa a Lens y k9s](/es/lens-alternative)
- [Dashboard multi-cloud](/es/multi-cloud-dashboard)

<small>Kubernetes es una marca registrada de The Linux Foundation. AWS, Google Cloud, Vercel, Lens y k9s son marcas de sus respectivos dueños. KUA es un proyecto open source independiente, sin afiliación ni respaldo de ellos.</small>
