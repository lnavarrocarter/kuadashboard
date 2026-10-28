---
layout: home
title: KUA — Open Source Kubernetes & Multi-Cloud Desktop Dashboard
titleTemplate: false
description: Open source Kubernetes and multi-cloud dashboard for managing AWS, GCP, Vercel, Helm, logs and infrastructure operations from one interface.

hero:
  name: KUA
  text: Kubernetes and multiple clouds in one app
  tagline: "No more jumping between consoles and terminals. Your Kubernetes clusters, AWS, GCP and Vercel in one free, open source desktop app for Windows, macOS and Linux."
  image:
    src: /screenshots/dashboard-main.png
    alt: KUA dashboard showing a Kubernetes cluster overview
  actions:
    - theme: brand
      text: Download
      link: /download
    - theme: alt
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: ⭐ Star on GitHub
      link: https://github.com/lnavarrocarter/kuadashboard

features:
  - icon: ☁️
    title: Unified Multi-Cloud
    details: AWS (EC2, ECS, EKS, Lambda, S3, DynamoDB, Secrets Manager and more) + GCP (Cloud Run, GKE, SQL, Storage) in one interface with persistent credentials.
  - icon: ☸️
    title: Kubernetes Management
    details: Broad resource coverage with multi-select tables, bulk delete, editable ConfigMaps/Secrets/envs, kubeconfig import, metrics, events and one-click operations.
  - icon: 🧭
    title: Advisor
    details: "Deterministic good-practice checks for Kubernetes, AWS, GCP and Vercel (security, infrastructure, architecture, development), with the affected resources and what each scan costs."
  - icon: 🧩
    title: KUA Applications
    details: "One workspace per application across clusters and clouds — resources with their signal state, a map with routes, log intelligence and a product Advisor."
  - icon: 🤖
    title: AI agents (MCP)
    details: "A local MCP server lets Claude Code, Codex CLI and other agents read KUA — Advisor findings, recurring log errors, applications — and change KUApps only after you approve."
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
    a: "KUA (KuaDashboard) is a free, open source desktop dashboard for Kubernetes, AWS, GCP and Vercel. It shows clusters, pods, deployments, logs, shells, port forwards, Helm releases, CloudWatch logs and cloud costs in one app for Windows, macOS and Linux, with an Advisor, KUA Applications that group the resources of each application, and an MCP server for AI agents."
  - q: "Is KUA an alternative to Lens or k9s?"
    a: "Yes. Like Lens or k9s, KUA manages Kubernetes clusters from your kubeconfig: workloads, logs, pod exec, port forwarding, events, metrics and Helm. It also manages AWS, GCP and Vercel resources in the same window, which those tools do not."
  - q: "Does KUA work with EKS, GKE and AKS?"
    a: "Yes. KUA works with any cluster in your kubeconfig, including Amazon EKS, Google GKE, Azure AKS, k3s, kind and minikube, and it can import kubeconfigs for EKS and GKE from your cloud profiles."
  - q: "Is KUA free?"
    a: "Yes. KUA is open source under the MIT license and every local feature is free. Optional Pro and Team plans add cloud backups, sync between computers, the Advisor and team sharing."
  - q: "Can AI agents use KUA?"
    a: "Yes. KUA ships a local MCP server: Claude Code, Codex CLI and other MCP clients read your profiles, Advisor findings, log intelligence and KUA Applications through the KUA running on your computer, and Connect an AI agent installs it. Changes to KUA Applications are previewed and applied only after you approve them, and agents can be turned off from the tray."
  - q: "Do my credentials leave my computer?"
    a: "No. Kubeconfigs, cloud credentials, profiles and logs stay on your computer, encrypted with the operating system keychain. KUA talks to your clusters and cloud APIs directly."
---

## A Kubernetes and cloud dashboard on your desktop

KUA puts your **Kubernetes clusters**, **AWS** and **GCP** accounts and **Vercel** projects in one desktop app. Browse pods, deployments and services, read live and historical logs, open a shell in a pod or an EC2 instance, forward ports, install Helm charts, search CloudWatch logs, find recurring errors and see what your cloud API calls cost — without switching between the AWS console, the GCP console, `kubectl` and a terminal.

- **Kubernetes:** multi-cluster kubeconfig, workloads, ConfigMaps and Secrets, logs, exec, port forwarding, events, metrics, Helm.
- **AWS:** EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, Secrets Manager, CloudWatch Logs and Logs Insights, IAM-aware least privilege.
- **GCP:** Cloud Run, GKE, Cloud SQL, Cloud Storage.
- **Advisor and KUA Applications:** good-practice findings per provider, and one workspace per application with its resources, map and signals.
- **AI agents:** a local MCP server for Claude Code, Codex CLI and other agents, with changes only after your approval.
- **Local and private:** credentials stay encrypted on your computer; the app is open source.

**Coming in the next release:** Plugins/Connections (Vercel and Proxmox VE as plugins), a KUA extension for VS Code, a Claude Code plugin, a Claude Desktop extension and one-click setup for Cursor, Windsurf, Gemini CLI and Kiro. See [Unreleased in the changelog](/changelog#unreleased).

[Download KUA](/download) · [Getting started](/guide/getting-started) · [All features](/features/)

<script setup>
import { withBase } from 'vitepress'
</script>

## See it in action

<div class="home-shots">
  <figure>
    <img :src="withBase('/screenshots/dashboard-pods.png')" alt="Pods of a Kubernetes cluster with status, restarts and age" loading="lazy" />
    <figcaption><strong>Pods, logs and shell.</strong> Inspect workloads, read live logs and open a shell in a pod.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/dashboard-deployments.png')" alt="Deployments list with replicas and images" loading="lazy" />
    <figcaption><strong>Deployments.</strong> Scale, restart and edit workloads without writing <code>kubectl</code> commands.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/dashboard-services.png')" alt="Services list with type, ports and cluster IPs" loading="lazy" />
    <figcaption><strong>Services and port forwarding.</strong> Open a tunnel to a Service or Pod in one click.</figcaption>
  </figure>
  <figure>
    <img :src="withBase('/screenshots/dashboard-nodes.png')" alt="Nodes view with capacity and conditions" loading="lazy" />
    <figcaption><strong>Nodes and metrics.</strong> Check capacity, conditions and usage across your clusters.</figcaption>
  </figure>
</div>

## Download KUA for your system

<div class="home-download">
  <a class="home-os" :href="withBase('/download')">
    <span class="home-os-icon" aria-hidden="true">🪟</span>
    <strong>Windows</strong>
    <span>Windows 10 or later · x64</span>
  </a>
  <a class="home-os" :href="withBase('/download')">
    <span class="home-os-icon" aria-hidden="true">🍎</span>
    <strong>macOS</strong>
    <span>macOS 12 or later · Intel and Apple Silicon</span>
  </a>
  <a class="home-os" :href="withBase('/download')">
    <span class="home-os-icon" aria-hidden="true">🐧</span>
    <strong>Linux</strong>
    <span>Ubuntu 20.04+ / Debian 11+ · x64 · AppImage and .deb</span>
  </a>
</div>

Every release is built on GitHub Actions and ships with a `SHA256SUMS.txt` file. [See all releases and checksums](/download).

## Plans: free to start, Pro and Team when you need more

- **Free (USD 0):** every local feature, up to 3 KUA Applications, a 256 MB log cache and manual refresh.
- **Pro (USD 9 per month or USD 90 per year):** Advisor, AI agents through MCP, scheduled tasks, unlimited KUA Applications, a 2 GB log cache and automatic refresh every 15 minutes or more.
- **Team (USD 29 per month or USD 290 per year):** everything in Pro, refresh every 1 minute, a 20 GB log cache and up to 10 members.

The Free limits apply from 2026-11-10.

[Compare plans](/pricing) · [Download KUA](/download)

## Like KUA? Give it a star

KUA is free and built in the open. A star on GitHub is the easiest way to help other engineers find it, and [sponsoring the project](/sponsor) keeps it moving.

<div class="home-social">
  <a href="https://github.com/lnavarrocarter/kuadashboard"><img src="https://img.shields.io/github/stars/lnavarrocarter/kuadashboard?style=social" alt="GitHub stars" loading="lazy" /></a>
  <a href="https://github.com/lnavarrocarter/kuadashboard/releases"><img src="https://img.shields.io/github/v/release/lnavarrocarter/kuadashboard" alt="Latest GitHub release" loading="lazy" /></a>
  <a href="https://github.com/lnavarrocarter/kuadashboard/"><img src="https://img.shields.io/github/license/lnavarrocarter/kuadashboard" alt="MIT license" loading="lazy" /></a>
</div>

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>
