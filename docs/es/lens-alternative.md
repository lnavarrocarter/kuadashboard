---
title: "Alternativa a Lens y k9s — IDE de Kubernetes gratis y open source"
description: "¿Buscas una alternativa a Lens o k9s? KUA es una app de escritorio de Kubernetes gratuita y open source con workloads, logs, shell, port forwarding y Helm, más AWS, Google Cloud y Vercel en la misma ventana."
schema: app
faq:
  - q: "¿KUA es una alternativa a Lens?"
    a: "Sí. Como Lens, KUA es una app de escritorio de Kubernetes que lee tu kubeconfig y muestra workloads, logs, shells, port forwards, eventos, métricas y Helm. Es open source con licencia MIT y además administra AWS, Google Cloud y Vercel."
  - q: "¿KUA es una alternativa a k9s?"
    a: "KUA cubre el mismo trabajo diario con Kubernetes que k9s (explorar recursos, logs, exec, port forwarding) en una app de escritorio gráfica en vez de una interfaz de terminal, y agrega proveedores cloud, un Advisor y agentes de IA."
  - q: "¿Puedo usar KUA junto con kubectl?"
    a: "Sí. KUA lee el mismo kubeconfig que kubectl, así que puedes seguir usando kubectl, k9s o Lens a la par."
---

# Una alternativa gratuita y open source a Lens y k9s

Lens y k9s son formas populares de trabajar con Kubernetes. Si quieres una **app de escritorio de Kubernetes gratuita y open source** que también cubra las cuentas cloud alrededor de tus clústeres, KUA es una alternativa: lee el mismo kubeconfig y agrega AWS, Google Cloud y Vercel, un Advisor y agentes de IA en una ventana.

![Deployments en la app de escritorio de Kubernetes de KUA](/screenshots/dashboard-deployments.png)

## Lo que mantienes

- Cada clúster y contexto de tu kubeconfig, con selector de namespace.
- Workloads y recursos con filtros y selección múltiple, ver y editar YAML, eventos y métricas.
- Logs en vivo de un pod o de un workload completo, y una shell interactiva en cualquier contenedor.
- Port forwarding a Services y Pods, con reconexión automática.
- Charts y releases de Helm.

## Lo que KUA agrega

- **Tus nubes junto a tus clústeres:** AWS, Google Cloud y Vercel en la misma app, con un solo baúl de credenciales cifrado.
- **Advisor:** hallazgos de buenas prácticas para Kubernetes y cada nube, con los recursos afectados.
- **Log intelligence:** firmas de errores recurrentes en un workload y entre nubes.
- **KUA Applications:** un espacio de trabajo por aplicación que agrupa sus workloads de Kubernetes con sus recursos cloud.
- **Agentes de IA por MCP:** Claude Code, Codex CLI y otros agentes leen lo que KUA sabe y cambian KUApps solo después de que apruebas.
- **Open source, licencia MIT:** todas las funciones locales son gratuitas, sin cuenta obligatoria.

## Cambiarte toma un minuto

Instala KUA, ábrelo y elige un contexto: lee el kubeconfig que ya usas, así que no hay nada que importar ni configurar.

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Sigue leyendo

- [Dashboard de Kubernetes](/es/kubernetes-dashboard)
- [Kubernetes en detalle](/es/features/kubernetes)
- [Agentes de IA (MCP)](/es/features/ai-agents)
- [Dashboard multi-cloud](/es/multi-cloud-dashboard)

<small>Kubernetes es una marca registrada de The Linux Foundation. AWS, Google Cloud, Vercel, Lens y k9s son marcas de sus respectivos dueños. KUA es un proyecto open source independiente, sin afiliación ni respaldo de ellos.</small>
