# Vercel Integration

KuaDashboard provides a full Vercel management panel accessible from the **Vercel** provider tab. Manage your projects, deployments, domains, environment variables, and serverless functions without leaving the dashboard.

## Authentication

Vercel credentials can be configured in two ways:

| Method | Description |
|---|---|
| **API Token** | Generate a token at [vercel.com/account/tokens](https://vercel.com/account/tokens) and store it with the Env Manager (key icon) |
| **OAuth (Electron only)** | Click **Connect with Vercel** in the Add Connection dialog to authorize via browser — no copy-pasting required |

### Using an API Token

1. Open the **Env Manager** (key icon in the toolbar)
2. Click **Add Connection** and select **Vercel** as the provider
3. Enter your `VERCEL_API_TOKEN`
4. Optionally add a `VERCEL_TEAM_ID` if your token belongs to a Vercel team account (format: `team_XXXXXXXXXXXX`)
5. Give the profile a name and save

### Using OAuth (Electron app only)

1. Click **Add Connection** and select **Vercel**
2. Click **Connect with Vercel** — your default browser opens the Vercel authorization page
3. Authorize KuaDashboard — Vercel redirects back to the app via the `kua://` deep-link
4. The profile is saved automatically and selected as active

> **Note:** OAuth requires `VERCEL_OAUTH_CLIENT_ID` and `VERCEL_OAUTH_CLIENT_SECRET` to be set in the app environment. These are bundled in the official release.

---

## Projects

The **Projects** tab shows all Vercel projects accessible with the active profile.

| Column | Description |
|---|---|
| Name | Project name — click to navigate to its deployments |
| Framework | Detected framework (Next.js, Vite, etc.) |
| Last Deploy | State of the most recent deployment (`READY`, `ERROR`, `BUILDING`, etc.) |
| URL | Production URL of the latest deployment |
| Repo | Linked Git repository |
| Updated | Last activity timestamp |

**Actions per project:**

- **Deployments** — switch to the Deployments tab scoped to this project
- **Domains** — switch to the Domains tab scoped to this project
- **Env Vars** — switch to the Env Vars tab scoped to this project

---

## Deployments

Lists all deployments for the selected project. Use the **target** filter to narrow by environment:

- **All** — all deployments
- **Production** — only `target: production`
- **Preview** — only `target: preview`

| Column | Description |
|---|---|
| Deployment | Deployment UID |
| State | `READY` / `ERROR` / `BUILDING` / `QUEUED` / `CANCELED` |
| Target | `production` or `preview` |
| URL | Deployment URL |
| Creator | Email/username of the person who triggered it |
| Created | Creation timestamp |

**Actions per deployment:**

- **Logs** — open the real-time build log panel (SSE streaming)
- **Functions** — view the serverless/edge functions in this deployment
- **Redeploy** — trigger a new deployment from the same source
- **Promote** — promote a preview deployment to production *(hidden for production deployments)*
- **Cancel** — cancel a deployment that is `BUILDING` or `QUEUED`

### Build Logs

Click **Logs** on any deployment to open the log panel. Logs stream in real time via Server-Sent Events. The panel supports:

- **Auto-scroll** — keep the view pinned to the latest line
- **Clear** — wipe the current log buffer
- Line coloring by event type: `stdout` (white), `stderr` (red), `command` (yellow), deployment state (blue)

---

## Domains

Lists all custom domains configured for the selected project.

| Column | Description |
|---|---|
| Domain | Full domain name |
| Apex | Root domain |
| Branch | Git branch this domain is mapped to (if any) |
| Redirect | Target URL if the domain is a redirect |
| Verified | Whether the DNS records have been verified by Vercel |

---

## Environment Variables

Lists all environment variable **keys** for the selected project. Values are intentionally never displayed or transmitted — this is a security measure to prevent accidental exposure of secrets.

| Column | Description |
|---|---|
| Key | Variable name |
| Type | `plain`, `secret`, or `sensitive` |
| Target | Environments the variable applies to (production / preview / development) |

---

## Functions

Lists the serverless and edge functions included in a selected deployment.

| Column | Description |
|---|---|
| Function | File path within the deployment |
| Type | `lambda` (Node.js serverless) or `edge` |
| Mode | Execution mode reported by Vercel |

> Select a deployment from the Deployments tab first — the Functions tab shows the functions of the currently selected deployment.

---

## Switching Profiles

Use the profile dropdown in the header to switch between multiple Vercel accounts or team profiles. The selection is persisted across sessions.
