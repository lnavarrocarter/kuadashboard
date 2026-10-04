---
layout: home
title: KUA — Open Source Kubernetes & Multi-Cloud Desktop Dashboard
titleTemplate: false
description: Open source Kubernetes and multi-cloud dashboard for managing AWS, GCP, Vercel, Helm, logs and infrastructure operations from one interface.

hero:
  name: KUA
  text: The Kubernetes & multi-cloud desktop dashboard
  tagline: "Know Unified Administration: your Kubernetes clusters, AWS, GCP and Vercel in one open source app for Windows, macOS and Linux."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Download App
      link: /download
    - theme: alt
      text: GitHub
      link: https://github.com/lnavarrocarter/kuadashboard
    - theme: alt
      text: 💖 Sponsor
      link: /sponsor

features:
  - icon: ☁️
    title: Unified Multi-Cloud
    details: AWS (EC2, ECS, EKS, Lambda, S3, DynamoDB, Secrets Manager and more) + GCP (Cloud Run, GKE, SQL, Storage) in one interface with persistent credentials.
  - icon: ☸️
    title: Kubernetes Management
    details: Broad resource coverage with multi-select tables, bulk delete, editable ConfigMaps/Secrets/envs, kubeconfig import, metrics, events and one-click operations.
  - icon: 📺
    title: Live Logs & Shell
    details: Real-time logs for pods and workloads, search/date filters, downloads, interactive pod exec, local shell and persistent EC2 SSH/RDP sessions.
  - icon: 🔐
    title: Env Manager
    details: Encrypted credential profiles (AES-256) for AWS, GCP and generics. Import/export .env files. Secrets Manager integration.
  - icon: 🔌
    title: Port Forwarding
    details: Reliable tunnels to Services and Pods with target pod resolution, persistent sessions, auto-reconnect and an integrated visual panel.
  - icon: 📦
    title: Helm Operations
    details: Search charts, install them into the active cluster, review releases and use a metrics-server preset for local or self-signed clusters.
  - icon: 🖥️
    title: Desktop App
    details: Native experience on Windows, macOS and Linux via Electron. Integrated backend, auto-update and instant startup.

faq:
  - q: "What is KUA?"
    a: "KUA (KuaDashboard) is a free, open source desktop dashboard for Kubernetes, AWS, GCP and Vercel. It shows clusters, pods, deployments, logs, shells, port forwards, Helm releases, CloudWatch logs and cloud costs in one app for Windows, macOS and Linux."
  - q: "Is KUA an alternative to Lens or k9s?"
    a: "Yes. Like Lens or k9s, KUA manages Kubernetes clusters from your kubeconfig: workloads, logs, pod exec, port forwarding, events, metrics and Helm. It also manages AWS, GCP and Vercel resources in the same window, which those tools do not."
  - q: "Does KUA work with EKS, GKE and AKS?"
    a: "Yes. KUA works with any cluster in your kubeconfig, including Amazon EKS, Google GKE, Azure AKS, k3s, kind and minikube, and it can import kubeconfigs for EKS and GKE from your cloud profiles."
  - q: "Is KUA free?"
    a: "Yes. KUA is open source under the MIT license and every local feature is free. Optional Pro and Team plans add cloud backups, sync between computers, the Advisor and team sharing."
  - q: "Do my credentials leave my computer?"
    a: "No. Kubeconfigs, cloud credentials, profiles and logs stay on your computer, encrypted with the operating system keychain. KUA talks to your clusters and cloud APIs directly."
---

## A Kubernetes and cloud dashboard on your desktop

KUA puts your **Kubernetes clusters**, **AWS** and **GCP** accounts and **Vercel** projects in one desktop app. Browse pods, deployments and services, read live and historical logs, open a shell in a pod or an EC2 instance, forward ports, install Helm charts, search CloudWatch logs, find recurring errors and see what your cloud API calls cost — without switching between the AWS console, the GCP console, `kubectl` and a terminal.

- **Kubernetes:** multi-cluster kubeconfig, workloads, ConfigMaps and Secrets, logs, exec, port forwarding, events, metrics, Helm.
- **AWS:** EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, Secrets Manager, CloudWatch Logs and Logs Insights, IAM-aware least privilege.
- **GCP:** Cloud Run, GKE, Cloud SQL, Cloud Storage.
- **Local and private:** credentials stay encrypted on your computer; the app is open source.

[Download KUA](/download) · [Getting started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>
