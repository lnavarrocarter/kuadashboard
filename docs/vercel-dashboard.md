---
title: "Vercel Dashboard for Desktop — Projects, Deployments and Logs"
description: "KUA is a free, open source desktop Vercel dashboard: projects, deployments, build logs, domains, environment variable names and functions for every team, next to your AWS, Google Cloud and Kubernetes."
schema: app
faq:
  - q: "Is KUA a Vercel dashboard?"
    a: "Yes. KUA shows your Vercel projects, deployments, build logs, domains, environment variable names and functions in a desktop app, for every team you connect, next to your other clouds."
  - q: "Can I redeploy or promote from KUA?"
    a: "Yes. Redeploy, promote and cancel are available on each deployment, and KUA asks you to confirm each one before it runs."
  - q: "Is KUA affiliated with Vercel?"
    a: "No. KUA is an independent, free and open source project (MIT license) that uses the public Vercel REST API."
---

# A Vercel dashboard on your desktop, next to the rest of your stack

Your frontend is on Vercel, but its API, queues and databases live somewhere else. KUA is a free and open source **Vercel dashboard** for your desktop that shows your Vercel projects and deployments for every team in the same app as your AWS accounts, Google Cloud projects and Kubernetes clusters.

## Your Vercel projects and deployments

- **Projects:** every project with its framework, latest deployment state and production URL.
- **Deployments:** per project, filtered by production or preview, with redeploy, promote and cancel (each confirmed first).
- **Build logs:** streamed in real time, with auto-scroll.
- **Domains:** custom domains, DNS verification state and git branch mappings.
- **Environment variables:** their names and targets per project — values are never shown.
- **Functions:** the serverless and edge functions of any deployment.

## Beyond the Vercel dashboard

- **Several teams at once:** one profile per team or personal account, connected with one-click OAuth in the desktop app or a token.
- **Advisor for Vercel:** good-practice findings for your team and projects.
- **Logs with intelligence:** Vercel logs join the recurring error signatures KUA finds across your clouds.
- **KUA Applications:** a Vercel project can belong to an application together with the AWS, GCP and Kubernetes resources behind it.

## Free reads, local credentials

KUA reads the Vercel REST API with the token of each profile, which Vercel does not charge for. Tokens stay encrypted on your computer.

[Download KUA](/download) · [Get started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Keep reading

- [Vercel features in detail](/features/vercel)
- [Multi-cloud dashboard](/multi-cloud-dashboard)
- [AWS dashboard](/aws-dashboard)
- [Advisor](/features/advisor)

<small>Kubernetes is a registered trademark of The Linux Foundation. AWS, Google Cloud, Vercel, Lens and k9s are trademarks of their respective owners. KUA is an independent open source project, not affiliated with or endorsed by them.</small>
