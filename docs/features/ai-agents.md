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

All tools are read-only.

| Tool | What it returns |
| --- | --- |
| `list_profiles` | AWS, GCP and Vercel profiles (id, name, provider). Credentials are never returned |
| `aws_advisor` | AWS Advisor findings for a profile (cached 15 min, `refresh` scans again with free APIs) |
| `gcp_advisor` | GCP Advisor findings from the last stored overview |
| `kubernetes_advisor` | Kubernetes Advisor findings for the current context (optional `namespace`) |
| `list_log_groups` | CloudWatch log groups cached by KUA for a profile |
| `log_intelligence` | Brief of a cached log group: error rates, anomalies, signatures, recommendations, queries |
| `list_applications` | KUApps applications |
| `product_advisor` | Product findings of a KUApps application |

Advisor and log tools accept `format` (`markdown` by default, or `json` for the raw data) and `lang` (`en` or `es`). `profile` takes a profile id or name and can be omitted when there is only one profile of that provider.

### Setup from the app

Click the **plug** icon next to "Copy for AI agent" (in any Advisor or in the log recommendations) to open **Connect AI agents**. It shows the exact setup for Claude Code, Codex CLI, JSON clients (`.mcp.json`, Cursor, VS Code) and Codex `config.toml`, with the paths of your installation, ready to copy.

With the installed app, the server runs with the KuaDashboard executable in Node mode (`ELECTRON_RUN_AS_NODE=1`), so Node.js is not needed. After moving or reinstalling KUA, copy the setup again. The sections below show the setup from a copy of the repository.

### Requirements (from the repository)

- Node.js 18 or later.
- A copy of the KUA repository (the server is `mcp/server.mjs`; it has no dependencies to install).
- KuaDashboard running. The server reads `http://localhost:7190` by default; set `KUA_URL` if KUA runs elsewhere (for example `http://localhost:7192` with `npm run dev`).

### Claude Code

```bash
claude mcp add kua --scope user -- node /path/to/kuadashboard/mcp/server.mjs
```

Or, to share it with a project, add it to `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "kua": {
      "command": "node",
      "args": ["/path/to/kuadashboard/mcp/server.mjs"],
      "env": { "KUA_URL": "http://localhost:7190" }
    }
  }
}
```

Check it with `/mcp` inside Claude Code.

### Codex CLI

```bash
codex mcp add kua -- node /path/to/kuadashboard/mcp/server.mjs
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.kua]
command = "node"
args = ["/path/to/kuadashboard/mcp/server.mjs"]
env = { KUA_URL = "http://localhost:7190" }
```

### Other clients

Any client that runs local stdio MCP servers (Cursor, VS Code, Windsurf…) uses the same command: `node /path/to/kuadashboard/mcp/server.mjs`.

ChatGPT (web and desktop) only connects to remote MCP servers over HTTPS, which would mean exposing KUA to the internet. Use the copied brief there instead.

### Example prompts

- "Use KUA to read the AWS Advisor for the prod profile and fix the high findings in our Terraform."
- "Read the log intelligence of /aws/lambda/orders in KUA, find the code that throws those errors and propose a fix."
- "Check the Kubernetes Advisor for the shop namespace and update the Helm chart to add requests, limits and probes."

## Privacy

- Briefs and MCP answers only contain what KUA already shows on screen.
- Log samples are sanitized by KUA before they are stored; sensitive values are counted by type, never copied.
- Profile credentials never leave KUA: `list_profiles` returns id, name and provider only.
- Once a brief reaches an agent, it is handled by that agent's provider under its own terms.
