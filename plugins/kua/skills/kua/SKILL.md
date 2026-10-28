---
name: kua
description: How to work with KUA (Know Unified Administration), the local dashboard for Kubernetes, AWS, GCP and Vercel, through its MCP tools. Use it whenever the user asks about their clusters, cloud resources, Advisor findings, errors in logs, KUA Applications (KUApps) or the infrastructure behind the code in this repository, or asks to fix, investigate or attach something in KUA.
---

# Working with KUA

KUA runs on the user's computer and reads their Kubernetes contexts and AWS, GCP and Vercel
profiles. Its MCP tools (`mcp__plugin_kua_kua__*`) read what KUA already knows and computes:
inventory, deterministic Advisor findings, log intelligence over cached logs, and KUA Applications
with the signal state of each resource. Nothing is sent anywhere but this computer's KUA.

## If the tools are missing or KUA does not answer

- The server answered that KUA has not run here: ask the user to install KuaDashboard and open it
  once, then restart the session.
- A tool says KUA is not reachable: KUA is closed. Ask the user to open it; do not guess data.
- A tool answers `AGENTS_DISABLED`: the user turned agents off in KUA's tray panel. Tell them where
  to turn it back on; do not try another way around it.

## Read before acting

1. **Pick the scope first.** Call `list_profiles` (AWS, GCP, Vercel) or `list_kubernetes_contexts`.
   Use `check_profile` when access is in doubt before a larger query.
2. **Start from KUA's findings**, not from raw listings:
   - `aws_advisor`, `gcp_advisor`, `vercel_advisor`, `kubernetes_advisor` for good-practice findings;
   - `list_log_groups` / `log_intelligence`, `list_kube_log_workloads` / `kube_log_intelligence` and
     `search_logs` for recurring errors and their signatures;
   - `list_applications`, `get_application`, `list_application_resources` and `product_advisor`
     for a KUA Application: its resources, which ones need attention, and its product findings.
3. **Map findings to the code.** When the repository has infrastructure as code (Terraform,
   CloudFormation, CDK, Helm, Kubernetes manifests), change the code and propose a reviewable diff
   instead of changing the cloud by hand.

## Signal states of a KUA Application resource

`current` recent data · `stale` old data · `partial` part of the last collection failed ·
`no_data` nothing collected yet · `disabled` collection off · `error` the last collection failed ·
`no_connection` no verified profile of this computer reaches it · `unsupported` KUA does not
collect metrics for it · `gone` it no longer exists where it lived (deleted, or renamed by a
release: KUApps → Review suggests its successor). Say which state a resource is in; a resource
without data is never "healthy".

## Changing things

- KUA Applications change only through `preview_application_change`, then, after the user approves
  the preview you showed them, `apply_application_change` with its `planId` and `confirm: true`.
  Never apply without approval, and never retry an apply with a new preview to get around an error.
- Turning collection on or running it makes billed cloud calls: the preview carries
  `effects.cost`. Tell the user the estimated cost before asking for approval.
- Do not run destructive or billed operations (delete, replace, restart in production, scale up)
  without explicit confirmation, and say what each step costs.

## Hygiene

- Briefs and findings are snapshots: verify the current state (CLI, console or repository) before
  changing anything.
- Never print, log or commit secrets. KUA already redacts sensitive values in logs; do not try to
  recover them, and do not copy raw logs into the repository.
- Finish with a short report: what changed, what was left out and why, and how it was verified.
