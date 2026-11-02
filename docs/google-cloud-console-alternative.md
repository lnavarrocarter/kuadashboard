---
title: "Google Cloud Console Alternative for Desktop — GCP Dashboard"
description: "Manage Google Cloud from a desktop app: KUA is a free, open source GCP dashboard for Cloud Run, GKE, Compute Engine, Cloud SQL, Cloud Storage, BigQuery, Pub/Sub and more, with your gcloud configurations."
schema: app
faq:
  - q: "Is KUA a replacement for the Google Cloud console?"
    a: "KUA covers the everyday work in the services listed on this page from a desktop app, and adds an Advisor and multi-cloud views. For services it does not cover, or for billing and organization settings, you still use the Google Cloud console."
  - q: "How does KUA connect to Google Cloud?"
    a: "With the gcloud configurations already on your computer (Application Default Credentials) or with a service account key that KUA stores encrypted. It calls the Google Cloud APIs directly, with the permissions of that identity."
  - q: "Is KUA affiliated with Google?"
    a: "No. KUA is an independent, free and open source project (MIT license). It uses the public Google Cloud APIs."
---

# A desktop alternative to the Google Cloud console

The Google Cloud console is powerful, but switching projects, waiting for pages and losing your place across tabs adds up. KUA is a free and open source **Google Cloud (GCP) dashboard** for your desktop: it reads your projects with your own gcloud configurations or a service account and shows the services you use every day in one fast app, next to your AWS accounts, Vercel teams and Kubernetes clusters.

## The Google Cloud services you use, in one app

- **Compute:** Cloud Run (with minimum instances), Cloud Run Jobs and their executions, GKE, and Compute Engine VMs with start, stop and SSH without configuring keys.
- **Databases:** Cloud SQL (start and stop), Cloud Spanner and BigQuery with a SQL editor, Firestore documents and Memorystore.
- **Storage:** a Cloud Storage file browser with preview and download, and Artifact Registry packages.
- **Serverless and messaging:** Cloud Functions (invoke and logs), Pub/Sub topics and subscriptions, Cloud Tasks, Cloud Scheduler and Workflows.
- **Security and operations:** Secret Manager, Cloud KMS, service accounts, Cloud DNS, VPC networks, Cloud Build logs, Cloud Monitoring and an interactive Cloud Logging query panel.

## What the console does not give you

- **Advisor for GCP:** deterministic good-practice findings (security, infrastructure, architecture, development) with the affected resources.
- **Honest reads:** a list KUA could not read says why instead of showing 0, and late answers never land on another resource.
- **Several projects at once:** every gcloud configuration appears as a profile; switch projects without signing in again.
- **One app for every cloud:** the same window manages AWS, Vercel and Kubernetes.

## Your credentials stay yours

KUA uses your gcloud Application Default Credentials or a service account key stored encrypted on your computer, and calls the Google Cloud APIs directly. Nothing goes through a KUA server.

[Download KUA](/download) · [Get started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Keep reading

- [Google Cloud features in detail](/features/gcp)
- [Multi-cloud dashboard](/multi-cloud-dashboard)
- [Kubernetes dashboard for GKE](/kubernetes-dashboard)
- [Credentials and profiles](/guide/credentials)

<small>Kubernetes is a registered trademark of The Linux Foundation. AWS, Google Cloud, Vercel, Lens and k9s are trademarks of their respective owners. KUA is an independent open source project, not affiliated with or endorsed by them.</small>
