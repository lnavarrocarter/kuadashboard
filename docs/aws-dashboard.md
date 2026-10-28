---
title: "AWS Dashboard for Desktop — EC2, EKS, ECS, Lambda and CloudWatch"
description: "KUA is a free, open source AWS dashboard for your desktop: EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, CloudFormation, CloudWatch Logs and costs for every account and region, with SSO profiles."
schema: app
faq:
  - q: "Is KUA an AWS console alternative?"
    a: "For everyday work in the services on this page, yes: KUA shows them in a desktop app with the account and region always visible, an Advisor and costs. For services it does not cover, or account and billing settings, you still use the AWS Management Console."
  - q: "Does KUA work with AWS SSO (IAM Identity Center)?"
    a: "Yes. KUA reads the profiles in ~/.aws, including those created with aws configure sso, has a built-in SSO login, and accepts temporary STS credentials."
  - q: "Does using KUA cost money on AWS?"
    a: "Most reads are free AWS API calls. The ones AWS bills, such as CloudWatch GetMetricData, Logs Insights queries and Cost Explorer, say what they cost and have limits you control in Help → Options."
---

# An AWS dashboard on your desktop

KUA is a free and open source **AWS dashboard** that reads your accounts with the profiles you already use — including SSO and temporary credentials — and shows the services you work with every day in one desktop app, with the account and region always in sight.

![KUA AWS dashboard overview](/screenshots/dashboard-main.png)

## The AWS services you use, in one app

- **Compute:** EC2 with start, stop and persistent SSH and RDP sessions, ECS clusters, services and tasks, EKS clusters.
- **Serverless:** Lambda functions (configuration and invoke, confirmed first), API Gateway, EventBridge and Step Functions with a visual diagram.
- **Storage and data:** S3 browser, DynamoDB, RDS, ECR, EBS volumes, Glue, Athena and DocumentDB.
- **Networking:** VPC, Load Balancers, CloudFront and Route 53.
- **Operations:** CloudFormation stacks (read-only), CloudWatch Logs with a local cache and Logs Insights, CloudWatch dashboards, SQS, SNS and SES.

## What makes it faster than the console

- **Overview first:** what needs attention in the last 24 hours, before any table.
- **Every tab says its profile, account and region,** and unread data is never shown as zero.
- **Costs:** AWS costs from Cost Explorer per profile, and every billed read (CloudWatch metrics, Logs Insights) says what it costs before it runs.
- **Advisor for AWS:** IAM, S3, SQS, SNS, DynamoDB, CloudFront and more, from a cached scan.
- **Least privilege:** a read-only IAM policy guide, and KUA works with the permissions you give it.

## Your credentials stay on your computer

KUA uses your `~/.aws` profiles, SSO sessions or keys stored encrypted on your computer, and calls the AWS APIs directly. Its local API only listens on 127.0.0.1.

[Download KUA](/download) · [Get started](/guide/getting-started) · [All features](/features/)

## Frequently asked questions

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Keep reading

- [AWS features in detail](/features/aws)
- [Multi-cloud dashboard](/multi-cloud-dashboard)
- [Kubernetes dashboard for EKS](/kubernetes-dashboard)
- [Credentials and profiles](/guide/credentials)

<small>Kubernetes is a registered trademark of The Linux Foundation. AWS, Google Cloud, Vercel, Lens and k9s are trademarks of their respective owners. KUA is an independent open source project, not affiliated with or endorsed by them.</small>
