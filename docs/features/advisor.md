---
title: Advisor — Good Practices, Accepted Risks and Posture History
description: Deterministic good-practice checks for AWS, GCP, Kubernetes and KUApps applications in KUA, with accepted or silenced findings and the posture over time.
---

# Advisor

The **Advisor** reviews good practices with deterministic checks on data KUA already has, or on free control-plane APIs: no AI and no billed calls. It appears in the AWS, GCP and Kubernetes overviews (security, infrastructure, architecture and development) and, with the product lens, in each KUApps application (objectives, ownership, release path and telemetry).

The Advisor is part of the **Pro** and **Team** plans. On Free, it shows how many checks pass and how many findings there are per category and severity, without the resources or how to fix them.

## Findings and score

Each finding shows its severity, the affected resources (up to 10, with the total) and a link to the provider documentation. The score next to the title counts the checks that pass out of the checks that could run; sources KUA could not read (missing permissions) are listed apart, so "all good" is never confused with "could not look".

To hand the findings to a coding agent, see [AI Agents](./ai-agents).

## Accept or silence a finding

Open a finding and choose:

- **Accept risk**: the team knows the risk and owns it (for example, an SSH bastion with a public IP behind an allow list).
- **Silence**: the check does not apply here (for example, a test cluster without production data).

Both need a **reason** and accept an optional **expiry** (30, 90, 180 or 365 days; accepted risks default to 90). They apply to the whole rule or only to the resources you select, so a new resource that breaks the same rule is still reported.

Accepted and silenced findings:

- leave the score: they count neither as passed nor as failed checks;
- are listed apart under **Accepted and silenced**, with the reason, who decided and until when, and a **Revoke** button;
- come back as findings when the acceptance expires. The overview warns about acceptances that expire in the next 7 days and about the ones that already expired.

Every decision and revocation is recorded in the audit log (category *Advisor*) with its reason. The author is the linked KUA account, or *local* without one.

Acceptances follow the account or cluster: one taken for an AWS profile applies in every region, one for a Kubernetes context in every namespace. The acceptances of a KUApps application travel with it in its KUAAppBundle (export, import and sync between your computers).

## Posture over time

The chart button next to the score shows the **posture over time** for the last 90 days: the share of checks that pass and the number of high findings, for all categories or the selected one. Each analysis adds a point (identical results within an hour are one point, so automatic refreshes do not flood it); history is kept for a year, per profile and region, project, cluster and namespace, or application.

## Posture alerts

KUA compares each Advisor analysis with the previous one of the same scope and lists what changed in the **bell** of the top bar (Pro and Team):

- **New finding**: a high or medium finding that was not there before.
- **Fixed**: a finding that went away. One that left because it was accepted is not counted as fixed.
- **Acceptance expires on…**: an acceptance that ends within 7 days.
- **Acceptance expired**: the finding is back and counts again.

The first analysis of a scope is the baseline and raises no alerts. The same change alerts at most once a day, and alerts are kept 90 days. Clicking one opens its overview (the AWS or GCP profile, the Kubernetes overview or the KUApps application) and marks it read.

New high findings and expired acceptances also raise a **system notification** (Windows, macOS, Linux). Turn it off in **Help & Options → Options → Posture notifications**; the alerts stay in the bell. Alerts compare analyses KUA already ran: they never call a cloud provider by themselves.

## Scheduled analysis

Below the findings, **Scheduled analysis** makes KUA analyse that scope on its own, so the history and the posture alerts keep moving while nobody has the overview open: every 6, 12 or 24 hours on Pro, and also every hour on Team. A scheduled run calls the same route as the overview, so its results match an interactive scan.

| Overview | What a run reads | Cost |
| --- | --- | --- |
| AWS | The same control-plane APIs as the overview | Free |
| GCP | About 20 list calls of the overview | The Storage and Secret Manager lists are billed: about USD 0.001 a month every 6 hours |
| Kubernetes | The cluster | Free. It runs while that context is the active one in KUA; otherwise it waits |
| KUApps | Data KUA already has | No cloud call |

The panel shows the last run, the next one, and why a run failed or is waiting. Every change of a schedule is recorded in the audit log.

## Alert webhooks (Slack and Teams)

On the **Team** plan, posture alerts can also go to a Slack or Microsoft Teams channel: **Help & Options → Options → Alert webhooks**.

- **Slack**: create an *Incoming Webhook* (Apps → Incoming Webhooks) and paste its `https://hooks.slack.com/…` address.
- **Microsoft Teams**: in the channel, create a Workflow from the template *Post to a channel when a webhook request is received* and paste its address.

Each webhook chooses what it receives (high findings and expired acceptances; high and medium; or everything, fixes included) and the language of the messages. The alerts of one analysis arrive as one message. **Send test** checks the channel right away, and the last error is shown under the webhook.

Messages go straight from this computer to Slack or Teams, with no KUA server in between. They name the rule, its severity and the place (cluster, region, project or application), never resource names or credentials. The webhook address is a secret: it is kept in the system keychain (an encrypted file when there is none) and KUA only shows it masked. Only Slack and Teams addresses over HTTPS are accepted.
