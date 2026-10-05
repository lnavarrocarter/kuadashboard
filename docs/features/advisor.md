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
