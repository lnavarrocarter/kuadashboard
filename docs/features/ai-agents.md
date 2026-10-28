# AI Agents

KUA already finds problems with deterministic checks: the **Advisor** in every overview and the **log intelligence** of cached CloudWatch log groups. These two features hand those findings to a coding agent (Claude Code, Codex, ChatGPT, Cursor…) so it can fix them in your code and infrastructure.

Neither one uses AI inside KUA or calls a cloud provider: they reuse data KUA already has, so they cost nothing.

## Agent briefs

The Advisor (AWS, GCP and Kubernetes overviews, and the product lens in KUApps) and the log intelligence recommendations have two buttons:

- **Copy for AI agent**: copies a Markdown brief to the clipboard.
- **Download brief (.md)**: saves the same brief as a file.

The brief is a self-contained task, written in the app language:

| Section | Content |
| --- | --- |
| Context | Provider, account, profile, region, project, namespace, Kubernetes context or log group |
| Your task | Working rules for the agent: verify the current state first, fix by severity and root cause, change infrastructure as code instead of the console, ask before destructive or billed operations, never expose secrets, finish with a report |
| Findings / Recommendations | Severity, rule, affected resources and docs. For logs: activity, anomalies against the previous 7 days, sanitized error signatures, sensitive data found, Logs Insights queries and code snippets |
| How to verify | How to confirm the fix in KUA and with the provider CLI |

Paste it into any agent or chat. It works with every model because it is plain Markdown.

## MCP server

The KUA MCP server lets agents that support the [Model Context Protocol](https://modelcontextprotocol.io) ask KUA directly instead of pasting briefs. It runs on your machine over stdio and reads the KUA API, so **KuaDashboard must be open**.

### Tools

All tools read, except `apply_application_change`, which applies a KUApps change you approved (see Changing KUApps from an agent).

| Tool | What it returns |
| --- | --- |
| `list_profiles` | AWS, GCP and Vercel profiles (id, name, provider). When KUA has no AWS or GCP profile, it also lists the AWS CLI profiles (`~/.aws/config`) and gcloud configurations of this computer as `local:<name>`. Credentials are never returned |
| `check_profile` | Read-only access check for AWS, GCP, Vercel or a Kubernetes context. Reports connection, tested read permissions and a safe next step without returning credentials or raw provider errors |
| `aws_advisor` (Pro) | AWS Advisor findings for a profile (cached 15 min, `refresh` scans again with free APIs) |
| `gcp_advisor` (Pro) | GCP Advisor findings from the stored overview; pass `refresh: true` to force a new inventory and scan. Reports whether the snapshot is fresh, cached or stale |
| `vercel_advisor` (Pro) | Vercel Advisor findings for a profile's account or team (cached 15 min, `refresh` scans again with free Vercel API reads). Env var values are never read |
| `kubernetes_advisor` (Pro) | Kubernetes Advisor findings for the current context (optional `namespace`) |
| `list_log_groups` | CloudWatch log groups cached by KUA for a profile |
| `log_intelligence` | Brief of a cached log group: error rates, anomalies, similar errors, signatures, recommendations, queries |
| `search_logs` | Recurring errors of the cached log groups found by meaning, in any language (needs Local ML enabled in KUA); `provider: "kubernetes"` searches cached Kubernetes workloads |
| `list_kube_log_workloads` | Kubernetes workloads whose pod logs KUA caches for the current context |
| `kube_log_intelligence` | Brief of a cached Kubernetes workload: error rates, anomalies, similar errors, recommendations, queries |
| `list_kubernetes_contexts` | Local Kubernetes contexts (context and cluster names; no API-server addresses or credentials) |
| `kubernetes_architecture` | Read-only live inventory of workloads, Pods, Services, Ingresses, PVCs/PVs and Nodes, with health and relationships. Filter by context, namespace, resource type and limit; Secret values and event messages are omitted |
| `cloud_resource_inventory` | Read-only live inventory for AWS, GCP or Vercel using a selected profile. Search by text, filter by resource type, and use `nextCursor` to page through the same five-minute snapshot without rescanning. AWS supports region and CloudFormation stack filters, verifies the account through STS, and accepts `scan_limit` (500 by default, up to 5,000); the estimate reports the cap and source truncation. AWS regional queries skip slow IAM role-policy expansion (architecture-map previews retain it). Never changes resources or downloads Lambda code |
| `list_applications` | KUApps applications |
| `product_advisor` (Pro) | Product findings of a KUApps application |
| `get_application` | One KUA Application as KUApps shows it: identity, revision, scopes with whether this computer has a verified profile for each (never the profile itself), architecture views, resources counted by signal state and relationships by status, and warnings |
| `list_application_resources` | Its resources: portable identity, provider scope, sources, signal state (`current`, `stale`, `partial`, `no_data`, `disabled`, `error`, `no_connection`, `unsupported`) with the time of the latest data, and relationships. Filters `state` and `provider`; at most 500 (default 100), with `truncated` |
| `search_resources` | What an AWS account, GCP project or Kubernetes context holds, to attach it: by type, text, ARN (AWS) or full resource name (GCP). AWS: EC2, EBS, S3, DynamoDB, SQS, SNS, SES, Glue, Step Functions, load balancers and target groups, Route 53, CloudFront, RDS, API Gateway, EKS, ECS, EventBridge, Lambda. GCP: VMs, disks, GKE, Cloud SQL, buckets, Pub/Sub, Cloud Run, Functions, Firestore, Memorystore, Workflows, Scheduler, Tasks, BigQuery. Kubernetes: workloads, CronJobs, Jobs, Services, Ingresses, PVCs, PVs (with their EBS volume or disk) and Nodes (with their instance). Each item has the exact `attach` input. List/Describe only, no cost |
| `recommend_application_resources` | What else belongs to an application, with evidence and confidence: Step Functions definitions, Lambda environment, load balancer target groups, EC2 volumes, and for Kubernetes the EKS cluster, node instances and workload → PVC → PV → volume. Released volumes are flagged to review. Nothing is attached |
| `preview_application_change` | What a change to a KUA Application would do, as a plan to approve |
| `apply_application_change` | Applies an approved plan (needs Allow agents to change KUApps) |
| `get_application_change` | The outcome of a plan, for a lost response |
| `get_architecture_graph` | One architecture view of the application (default the first): nodes, hidden nodes, relationships with status, confidence, human decision and evidence kinds. It is the stored view at its revision, not a live read |

Advisor and log tools accept `format` (`markdown` by default, or `json` for the raw data) and `lang` (`en` or `es`). `profile` takes a KUA profile id or name, or the name of an AWS CLI profile or gcloud configuration of this computer (for example `prod`), so the agent can work before the profile is added to KUA. It can be omitted when there is only one profile of that provider.

### Turning agents off

**AI agent access (MCP)** turns agents on or off on this computer, from the KUA tray icon or **Connect an AI agent**. It is on by default. Off, KUA refuses every request from the MCP server (`AGENTS_DISABLED`, except discovery through `/api/health`) and the agent tells you where to turn it back on. The switch is stored on this computer, and an agent cannot change it. The tray panel also shows when the last agent request arrived.

### Plugins that are off

The tools of a provider whose plugin is off in **Plugins/Connections** (Vercel today) are not offered to agents: `vercel_advisor` leaves the tool list and `vercel` leaves the provider choices of `list_profiles` and `cloud_resource_inventory`. Calling them anyway answers `PLUGIN_DISABLED` with where to turn the plugin on. If KUA cannot say which plugins are on, the whole list is offered, as before.

### Changing KUApps from an agent

An agent can change a KUA Application in two steps, and only while you allow it: **Connect an AI agent → Allow agents to change KUApps** (off by default, stored on this computer). With it off, agents can still read and preview.

1. `preview_application_change` says what would change and returns a `planId` valid for 15 minutes. Nothing changes.
2. You approve the preview in the agent. Then `apply_application_change` runs that plan with `confirm: true`.

| Operation | Input | What it never does |
| --- | --- | --- |
| `application.create` | `name`, `environment`, `team`, `scopes` | create cloud resources |
| `application.update` | `name`, `environment`, `team` | |
| `resources.attach` | `resources[]` with `provider`, `type`, `key`, `name` and their scope: an ARN, or `scopeId` and `location`; `kubeContext` for Kubernetes. A name alone is refused | turn on collection |
| `resources.detach` | `resourceIds[]` (from `list_application_resources`) | delete the resource in the cloud |
| `view.link` / `view.unlink` | `projectId` | delete the view |
| `scopes.add` / `scopes.remove` | `provider`, `scopeId`, `location` (or `scopeKey` to remove); removing warns how many resources lose collection | |
| `resource.update` | `resourceId`, `enabled`, `name`, `service`, `logGroup`; enabling shows its collection cost | |
| `thresholds.update` | `thresholds` (error rate, duration, load balancer 5xx and latency, ready pods, restarts, recurring signatures) | |
| `collection.update` | `pollingEnabled`: on schedules collection every 30 minutes; the preview shows the calls and estimated USD per run and per month | collect before you approve |
| `collection.run` | none: collects once now; the preview shows the cost of one run | |
| `recommendations.dismiss` | `identityKeys[]` from `recommend_application_resources` | |

Collection costs are estimated at list prices: CloudWatch `GetMetricData` USD 0.01 per 1,000 metrics, and for Lambda logs `FilterLogEvents` (no request charge; data transfer out USD 0.09 per GB after 100 GB free per month). GCP signals use the Cloud Monitoring read API: USD 0.50 per million time series returned after the first million free per billing account each month (one series per metric per run). Glue job runs and Kubernetes collection have no cloud charge.

- **Stale previews are refused.** If the application changed after the preview, apply answers `409 REVISION_CONFLICT` with the current revision and writes nothing: preview again.
- **One plan, one write.** The plan is what is applied; the agent cannot change it in between. Applying the same `planId` again returns the recorded outcome. If a response is lost, `get_application_change` tells whether it was applied.
- **Partial outcomes are explicit.** Each attached or detached resource has its own outcome; a plan where some failed is `partial`.
- **Audited.** Each apply is in the audit log with the client (`mcp`), application, operation, plan and revisions before and after, without resource payloads or profiles.
- There is no tool to delete applications or infrastructure.

### Setup from the app

Click the **plug** icon next to "Copy for AI agent" (in any Advisor or in the log recommendations) to open **Connect AI agents**:

- **Install in Claude Code / Install in Codex** adds the server to the agent for you (user scope, replacing a previous `kua` entry). It needs the `claude` or `codex` command in the PATH of this computer; otherwise run the command shown in the terminal where you use the agent.
- **Verify connection** starts the server exactly as the agent will and checks that it reaches this KUA: it shows the number of tools and profiles, or what fails (KUA closed, another KUA open, the server cannot start).
- The setup for Claude Code, Codex CLI, JSON clients (`.mcp.json`, Cursor, VS Code) and Codex `config.toml` is ready to copy, with the paths of your installation. Windows paths use forward slashes, so they survive being pasted into bash, PowerShell or cmd.

With the installed app, the server runs with the KuaDashboard executable in Node mode (`ELECTRON_RUN_AS_NODE=1`), so Node.js is not needed. After moving or reinstalling KUA, install or copy the setup again. The sections below show the setup from a copy of the repository.

### Finding KUA

The server finds the running KUA by itself, whatever its port: the installed app (`7190`), development (`7192`) or another one. Each KUA writes where it listens to `~/.kuadashboard/run/` while it runs, and the server takes the newest one that answers. If KUA is closed, the agent is told so when it connects, and the server looks again on the next call, so opening KUA later is enough.

Set `KUA_URL` only to point the server at a specific KUA (for example when two are open).

### Requirements (from the repository)

- Node.js 18 or later.
- A copy of the KUA repository (the server is `mcp/server.mjs`; it has no dependencies to install).
- KuaDashboard running.

### Claude Code

The simplest way is the KUA plugin: **Install in Claude Code** in **Connect an AI agent** installs it from this computer, without downloading anything (KUA keeps a local marketplace with the plugin of its own version in `~/.kuadashboard/claude-plugin`; a Claude Code without plugins gets the MCP server alone). The plugin adds KUA's MCP server and a `kua` skill that tells Claude how to work with KUA: start from the Advisor and log intelligence, check the current state before changing anything, show the cost and ask before billed or destructive operations, and never copy secrets or raw logs into the repository.

From Claude Code itself, the same plugin installs from GitHub:

```text
/plugin install kua --marketplace lnavarrocarter/kuadashboard
```

On Claude Code before 2.1.275, add the marketplace first with `/plugin marketplace add lnavarrocarter/kuadashboard`, then `/plugin install kua@kuadashboard`. The plugin needs Node.js on PATH. It starts the MCP server of the KUA installed on this computer: every KUA records how to start it in `~/.kuadashboard/run/mcp-launch.json` (the installed app wins over a KUA run from the repository), so the server always matches your KUA version. If KUA has never run here, the server answers with no tools and tells Claude to install and open KUA. Check it with `/mcp`: the server is `plugin:kua:kua`.

Without the plugin, add the server by hand:

```bash
claude mcp add kua --scope user -- node /path/to/kuadashboard/mcp/server.mjs
```

Or, to share it with a project, add it to `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "kua": {
      "command": "node",
      "args": ["/path/to/kuadashboard/mcp/server.mjs"]
    }
  }
}
```

Check it with `/mcp` inside Claude Code.

### Claude Desktop

**Install in Claude Desktop** in **Connect an AI agent** opens `kua.mcpb`, the Claude Desktop extension that ships with KUA, and Claude Desktop shows its install dialog (it then appears under **Settings → Extensions**). **Download kua.mcpb** saves the same file to install it by hand, for example from KUA in a browser. The extension starts the MCP server of the KUA installed on this computer, like the Claude Code plugin, so it always matches your KUA version; its optional **KUA address** setting forces one KUA (leave it empty to find the running one). Without the extension, add the JSON shown in that tab to `claude_desktop_config.json` (**Settings → Developer → Edit Config**).

### Codex CLI

```bash
codex mcp add kua -- node /path/to/kuadashboard/mcp/server.mjs
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.kua]
command = "node"
args = ["/path/to/kuadashboard/mcp/server.mjs"]
```

### VS Code

The [KUA extension for VS Code](./vscode) registers KUA's MCP server for the editor's chat, with nothing to configure. Without the extension, add the `kua` entry to `.vscode/mcp.json` with the command below.

### Cursor, Windsurf, Gemini CLI and Kiro

**Connect an AI agent** has a tab for each. **Install** adds a `kua` entry to the agent's MCP file and keeps everything else in it: other servers, and for Gemini CLI the rest of its settings.

| Agent | File |
|---|---|
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Kiro (IDE and `kiro-cli`) | `~/.kiro/settings/mcp.json` (`$KIRO_HOME/settings/mcp.json` when `KIRO_HOME` is set) |

The tab says whether KUA is already in the file, and **Remove** takes out only KUA's entry. A file that is not valid JSON (for example with comments) is never rewritten: KUA says so and you fix it first. Restart the agent after installing.

Kiro's IDE and `kiro-cli` read the same user file, so one install covers both; in `kiro-cli`, `/mcp` shows the server. A `.kiro/settings/mcp.json` in a workspace adds to it (and wins for a server with the same name), so leave `kua` out of it.

### Other clients

Any client that runs local stdio MCP servers uses the same command: `node /path/to/kuadashboard/mcp/server.mjs`.

ChatGPT (web and desktop) only connects to remote MCP servers over HTTPS, which would mean exposing KUA to the internet. Use the copied brief there instead.

### Troubleshooting

Start with **Verify connection** in Connect AI agents: it names the problem. Inside the agent, `/mcp` lists the server and its state.

| What you see | What to do |
| --- | --- |
| `Connection closed` when the agent starts | The command did not start. On Windows this was usually a pasted path that lost its backslashes (`C:Users…`): install again with the button, or copy the setup again (paths now use forward slashes). |
| "KUA is not running at …" | Open KuaDashboard. The server looks again on the next call; no restart needed. |
| "Another KUA is running at …" (when verifying) | Two KUAs are open (for example the installed app and development) and the server reads the newest. Close one, or set `KUA_URL` to the one you want. |
| "KUA has no AWS/GCP profile" | Pass `profile` with the name of an AWS CLI profile or gcloud configuration of this computer (the error lists them), or add the profile in KUA with the key icon of the top bar (Env Manager). |
| "This MCP server is X" after updating KUA | The agent still runs the server of the previous version: start a new agent session. |

### Example prompts

- "Use KUA to read the AWS Advisor for the prod profile and fix the high findings in our Terraform."
- "Read the log intelligence of /aws/lambda/orders in KUA, find the code that throws those errors and propose a fix."
- "Check the Kubernetes Advisor for the shop namespace and update the Helm chart to add requests, limits and probes."
- "Read the Checkout application in KUA and tell me which of its resources have stale or missing signals."

## Privacy

- Briefs and MCP answers only contain what KUA already shows on screen.
- Log samples are sanitized by KUA before they are stored; sensitive values are counted by type, never copied.
- Profile credentials never leave KUA: `list_profiles` returns id, name and provider only.
- The KUA Application tools read the application through the same KUApps service as the UI. A name shared by several applications needs the id, and a view is only served through the application it belongs to. They report which scopes this computer can read, not which profile reaches them.
- Once a brief reaches an agent, it is handled by that agent's provider under its own terms.
