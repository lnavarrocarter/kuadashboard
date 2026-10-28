---
title: "Kubernetes Dashboard for Desktop — Free and Open Source"
description: "KUA is a free, open source Kubernetes dashboard for Windows, macOS and Linux: every cluster in your kubeconfig, workloads, logs, shell, port forwarding, Helm, YAML and metrics in one app."
schema: app
faq:
  - q: "Is KUA a Kubernetes dashboard?"
    a: "Yes. KUA is a desktop Kubernetes dashboard: it shows the workloads, logs, events and metrics of every cluster in your kubeconfig and lets you exec into pods, forward ports, edit YAML and run Helm, on Windows, macOS and Linux."
  - q: "Do I need to install anything in the cluster?"
    a: "No. Unlike the in-cluster Kubernetes Dashboard, KUA runs on your computer and uses your kubeconfig, so there is nothing to deploy and no service account token to expose. Metrics need metrics-server or Prometheus in the cluster, as kubectl top does."
  - q: "Is the KUA Kubernetes dashboard free?"
    a: "Yes. KUA is open source under the MIT license and every local Kubernetes feature is free. Optional Pro and Team plans add the Advisor, automatic log refresh, AI agents through MCP and team features."
---

# A Kubernetes dashboard on your desktop

KUA is a free and open source **Kubernetes dashboard** that runs on your computer. It reads the clusters in your kubeconfig — EKS, GKE, AKS, k3s, kind, minikube or your own — and shows their workloads, logs and health without installing anything in the cluster: no in-cluster dashboard to deploy, no token to expose, no port to open.

![Pods of a Kubernetes cluster in the KUA dashboard](/screenshots/dashboard-pods.png)

## Everything you do with kubectl, in one window

- **Workloads and resources:** Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingresses, ConfigMaps, Secrets, PVCs, HPAs, Nodes, Events and more, with filters, multi-select and "N of M" counts.
- **Logs and shell:** live logs of a pod or a whole workload (every container), search, date filters and download, and an interactive shell in any container.
- **Port forwarding:** tunnels to Services and Pods that survive pod restarts and reconnect on their own.
- **YAML:** view, edit, validate and apply any resource, with search and autocomplete.
- **Operations:** scale, restart, cordon, drain and delete, each confirming the cluster, context and namespace first.
- **Helm:** search charts, install or upgrade releases and uninstall them.
- **Metrics:** CPU and memory from metrics-server, with a Prometheus fallback, and usage without samples says so instead of showing 0.

## More than a cluster browser

- **Diagnosis path:** a pod links to its current and previous logs, ReplicaSet, Deployment, Node and Services; a Service says why it has no backends.
- **Advisor:** good-practice checks for the cluster and its workloads (privileged containers, running as root, secrets in plain environment variables, missing requests and memory limits, single replicas, no PodDisruptionBudget, crash loops and more), with the affected resources.
- **Log intelligence:** recurring error signatures across a workload's pods, from a local cache.
- **Multi-cluster:** switch contexts from the header, import kubeconfigs for EKS and GKE from your cloud profiles.

## Private by design

Your kubeconfig and credentials stay on your computer, encrypted with the operating system keychain. KUA talks to the Kubernetes API directly, with the permissions you already have, and its local API only listens on 127.0.0.1.

[Download KUA](/download) · [Get started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Keep reading

- [Kubernetes features in detail](/features/kubernetes)
- [Port forwarding](/features/port-forwarding)
- [A Lens and k9s alternative](/lens-alternative)
- [Multi-cloud dashboard](/multi-cloud-dashboard)

<small>Kubernetes is a registered trademark of The Linux Foundation. AWS, Google Cloud, Vercel, Lens and k9s are trademarks of their respective owners. KUA is an independent open source project, not affiliated with or endorsed by them.</small>
