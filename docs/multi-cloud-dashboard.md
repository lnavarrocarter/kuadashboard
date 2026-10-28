---
title: "Multi-Cloud Dashboard for AWS, Google Cloud, Vercel and Kubernetes"
description: "KUA is a free, open source multi-cloud dashboard: AWS, Google Cloud, Vercel and Kubernetes in one desktop app, with an Advisor, cross-cloud applications, log intelligence and cost you can see."
schema: app
faq:
  - q: "What is a multi-cloud dashboard?"
    a: "A multi-cloud dashboard shows the resources of several cloud providers in one place. KUA does it for AWS, Google Cloud, Vercel and Kubernetes from a desktop app, so you can browse, search logs and act on each provider without switching consoles."
  - q: "Does KUA send my cloud data to a server?"
    a: "No. KUA runs on your computer and calls each provider's API directly with your own profiles, which stay encrypted on your computer. An optional KUA account only stores your plan and, if you turn them on, backups and sync."
  - q: "Is the KUA multi-cloud dashboard free?"
    a: "Yes. KUA is open source under the MIT license; every local feature for AWS, Google Cloud, Vercel and Kubernetes is free. Pro and Team add the Advisor, automatic refresh, AI agents through MCP and team features."
---

# One multi-cloud dashboard for AWS, Google Cloud, Vercel and Kubernetes

Most teams run on more than one cloud: an EKS or GKE cluster, Lambda functions, Cloud Run services, a Vercel frontend. KUA is a **multi-cloud dashboard** that puts them in one desktop app, with one way to read, search and fix them, so you stop jumping between the AWS console, the Google Cloud console, the Vercel dashboard, `kubectl` and a terminal.

![KUA multi-cloud dashboard overview](/screenshots/dashboard-main.png)

## Every provider, side by side

- **Kubernetes:** every cluster in your kubeconfig, with workloads, logs, shell, port forwarding and Helm.
- **AWS:** EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, API Gateway, CloudFormation, CloudWatch Logs and more, with SSO and temporary credentials.
- **Google Cloud:** Cloud Run, GKE, Compute Engine, Cloud SQL, Cloud Storage, BigQuery, Pub/Sub and more, with your gcloud configurations or a service account.
- **Vercel:** projects, deployments, build logs, domains and environment variable names, for each team.

## Built for many clouds, not just many tabs

- **KUA Applications:** one workspace per application that groups its resources across clouds and clusters, with their signal state, a map and the routes between them.
- **Advisor:** the same kind of good-practice findings for Kubernetes, AWS, GCP and Vercel, grouped as security, infrastructure, architecture and development.
- **Log intelligence:** recurring error signatures across CloudWatch, Kubernetes, Cloud Logging and Vercel logs.
- **Cost you can see:** every read that is billed says what it costs before it runs, and AWS costs come from Cost Explorer per profile.
- **One credential vault:** profiles for each account, project and team, encrypted on your computer.

## Every action shows its account and region

Each view says which profile, account, project, region or cluster it reads, and writes confirm where they will act. Switching between clouds never leaves you guessing which environment you are in.

[Download KUA](/download) · [Get started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Keep reading

- [AWS dashboard](/aws-dashboard)
- [A desktop alternative to the Google Cloud console](/google-cloud-console-alternative)
- [Vercel dashboard](/vercel-dashboard)
- [Kubernetes dashboard](/kubernetes-dashboard)
- [Advisor](/features/advisor)

<small>Kubernetes is a registered trademark of The Linux Foundation. AWS, Google Cloud, Vercel, Lens and k9s are trademarks of their respective owners. KUA is an independent open source project, not affiliated with or endorsed by them.</small>
