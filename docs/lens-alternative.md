---
title: "Lens and k9s Alternative — Free Open Source Kubernetes IDE"
description: "Looking for a Lens or k9s alternative? KUA is a free, open source Kubernetes desktop app with workloads, logs, shell, port forwarding and Helm, plus AWS, Google Cloud and Vercel in the same window."
schema: app
faq:
  - q: "Is KUA a Lens alternative?"
    a: "Yes. Like Lens, KUA is a Kubernetes desktop app that reads your kubeconfig and shows workloads, logs, shells, port forwards, events, metrics and Helm. It is open source under the MIT license and also manages AWS, Google Cloud and Vercel."
  - q: "Is KUA a k9s alternative?"
    a: "KUA covers the same day-to-day Kubernetes work as k9s — browsing resources, logs, exec, port forwarding — in a graphical desktop app instead of a terminal UI, and adds cloud providers, an Advisor and AI agents."
  - q: "Can I use KUA and kubectl together?"
    a: "Yes. KUA reads the same kubeconfig as kubectl, so you can keep using kubectl, k9s or Lens alongside it."
---

# A free, open source alternative to Lens and k9s

Lens and k9s are popular ways to work with Kubernetes. If you want a **free and open source Kubernetes desktop app** that also covers the cloud accounts around your clusters, KUA is an alternative: it reads the same kubeconfig and adds AWS, Google Cloud and Vercel, an Advisor and AI agents in one window.

![Deployments in the KUA Kubernetes desktop app](/screenshots/dashboard-deployments.png)

## What you keep

- Every cluster and context in your kubeconfig, with a namespace selector.
- Workloads and resources with filters and multi-select, YAML view and edit, events and metrics.
- Live logs of a pod or a whole workload, and an interactive shell in any container.
- Port forwarding to Services and Pods, with automatic reconnection.
- Helm charts and releases.

## What KUA adds

- **Your clouds next to your clusters:** AWS, Google Cloud and Vercel in the same app, with one encrypted credential vault.
- **Advisor:** good-practice findings for Kubernetes and each cloud, with the affected resources.
- **Log intelligence:** recurring error signatures across a workload and across clouds.
- **KUA Applications:** one workspace per application that groups its Kubernetes workloads with its cloud resources.
- **AI agents through MCP:** Claude Code, Codex CLI and other agents read what KUA knows, and change KUApps only after you approve.
- **Open source, MIT license:** every local feature is free, with no account required.

## Switching takes a minute

Install KUA, open it and pick a context: it reads the kubeconfig you already use, so there is nothing to import or configure.

[Download KUA](/download) · [Get started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Keep reading

- [Kubernetes dashboard](/kubernetes-dashboard)
- [Kubernetes features in detail](/features/kubernetes)
- [AI agents (MCP)](/features/ai-agents)
- [Multi-cloud dashboard](/multi-cloud-dashboard)

<small>Kubernetes is a registered trademark of The Linux Foundation. AWS, Google Cloud, Vercel, Lens and k9s are trademarks of their respective owners. KUA is an independent open source project, not affiliated with or endorsed by them.</small>
