# Console session foundation (#37)

The global console contract is independent of Kubernetes. This foundation does
not implement the complete #36 epic, #35 cloud identity, #20 Architecture
overlays, or the full transport migration reserved for #39.

## Session contract

`frontend/src/shared/consoleSession.mjs` is the single registry imported by both
the backend and frontend. The terminal store exposes `capabilityRegistry`;
`GET /api/console/capabilities` exposes the same registry to other clients.
Consumers discover `provider`, `transport`, `status`, `required`, and (only for
available capabilities) the transport path. Planned entries cannot connect.

Every tab describes `provider`, `environment` (default: `default`),
`applicationId`, `profileId`, `region`, `project`, `kubeContext`, `target`,
`capabilities`, `transport`, and `connectionState`. Optional context is `null`.
The legacy `context: pod|local`, `type`, namespace/pod fields and tab APIs remain
compatible. An optional final context argument on `openLogsTab`, `openExecTab`
and `openLocalTab` carries application/environment/profile context.
`kubeContext` is the actual cluster context, not that legacy UI field.
`target` contains only allowlisted identifiers and connection options: namespace,
name, resourceType, container, selectedPod, host, user, instanceId, domain, port,
width and height. Arbitrary cloud `meta` is no longer retained.

Connection states: `idle → validating|reconnecting → connecting → connected`, ending in
`done`, `error` or `stopped` (see "EC2 SSH joins the shared registry" below for the full
normalization). Closing/restarting a pending tab invalidates its asynchronous attempt.
The tab descriptor (this section) is now persisted across a reload (see "Tab and
history persistence" below) — the live connection and its output are not; a restored
tab always comes back disconnected.

## Capability matrix

| Provider | Capability / transport | Required frontend context | Status |
| --- | --- | --- | --- |
| Local | local-shell / shell | None; local OS authority | Available |
| Kubernetes | kubernetes-logs / logs | target.namespace, target.name | Available |
| Kubernetes | kubernetes-exec / exec | target.namespace, target.name | Available |
| AWS EC2 | ec2-ssh / ssh | profileId, target.host, target.user | Available |
| AWS EC2 | ec2-rdp / rdp | profileId, target.host, target.user | Available (existing NLA limitation) |
| AWS | aws-ssm / ssm | profileId, target.instanceId | Available (requires `session-manager-plugin`) |
| GCP | gcp-shell / cloud-shell | profileId, project | **Unavailable** — Cloud Shell needs interactive per-user OAuth, no service-account path exists |
| GCP | gcp-logs / logs | profileId, project, region, target.name | Available (Cloud Run only) |
| Vercel | vercel-logs / deployment-logs | profileId, target.name | Available |

Kubernetes additionally requires a unique, valid backend kubeconfig context with
cluster and user entries. If omitted, the backend resolves its current context
once and pins a snapshot for the session. Later global context changes cannot
retarget an existing session. Exec accepts Pods; logs also accept deployments,
statefulsets and daemonsets.

EC2's profile is an **SSH/RDP credential profile**, not an AWS SDK identity.
Use an `aws` or `generic` profile in the existing Env Manager:

- SSH: `SSH_PRIVATE_KEY` (PEM contents), optional `SSH_PASSPHRASE`, or
  `SSH_PASSWORD`. A private key takes precedence when both are present.
- RDP: `RDP_PASSWORD`.

Copy its profile ID into the connection form. Direct password/passphrase entry
and renderer-selected key paths were removed. Provision credentials through the
existing credential-management boundary; the console never retrieves raw keys.
AWS `local:*` SDK profiles do not imply SSH credentials. Region/application/
environment metadata can be supplied by callers; they do not confer authority.

## Decision record: credentials, validation and audit

**Decision:** reuse `lib/credentialStore.js`, not a second secret store. Only the
backend resolver calls `getRawKeys`. Exact profile IDs are mandatory for EC2;
unknown, wrong-provider, duplicate and incomplete profiles fail closed.
Credential provisioning remains the existing Env Manager responsibility. This
does not claim the whole application's renderer never handles credential input.

Before constructing any WebSocket, clients validate the shared contract and
POST a sanitized descriptor to `/api/console/sessions`. The backend validates
authority and returns a public descriptor plus a one-use, 30-second ticket.
Only a local, same-origin request can obtain one (the Vite console proxy preserves
Host). Tickets are transport-bound, memory-only and capped at 256 pending entries.
They are ephemeral connection grants, not cloud credentials; avoid logging URLs.
All five console WebSocket upgrade paths reject missing, expired or reused tickets
before transport creation. Existing transport handlers consume the server-resolved
target and authority, never replacement credential/target fields from WS frames.
No provider tokens, passwords or private keys are returned to the console,
included in tabs, or transmitted by console clients.

`lib/auditLog.js` records `console` category `session.open`, `session.close` and
`session.error`, with provider, environment, transport and target identifiers.
Preflight rejection is an error; open means the validated WebSocket was accepted,
not that remote authentication succeeded. Transport errors are separately logged.
Audit uses an explicit metadata allowlist: no commands, stdin, output, raw error
messages, entire request bodies, credential authority or connection tickets.
Output may naturally contain secrets printed by a command; this foundation does
not promise redaction of arbitrary interactive terminal output.

**Trade-off:** SSH/RDP keep their current modals and implementations, but credential
resolution and connection admission migrate now to enforce the boundary. Full
provider UI unification and transport adapters remain #39 work. Loopback admission
is a desktop boundary, not multi-user authentication or cloud authorization.

## Global access and dedicated workspace (#38)

The quick panel (`TerminalPanel.vue`, bottom of the app) stays the default,
per-action surface: opening logs/exec from a resource table still opens it,
unchanged. A new, separate global header button (`ConsoleWorkspaceView.vue`,
toggled the same way as Env Manager/Audit Log via `cloudView`) reads the exact
same `useTerminalStore()` Pinia singleton, so both surfaces always show the same
session list — there is no second store, no synced copy, and no way for a
session opened in one to be invisible in the other.

**Scope decision:** EC2 SSH/RDP stay out of `useTerminalStore` for this ticket.
They're listed in the workspace launcher as "available, opened from the AWS
view" rather than a generic connect button, since building a generic
profile/instance picker here would duplicate `Ec2Shell.vue`/`Ec2Rdp.vue`'s
existing UI. Folding them into the shared store/launcher is #39's job
("Migrar Local, Kubernetes y EC2 al registro comun"). Planned capabilities
render disabled with no click handler at all — the registry's `status` is the
only thing gating them, so a newly "available" capability (as `aws-ssm` became
in #41) lights up the launcher with no further UI change. `gcp-shell` and
`vercel-logs` remain planned as of this writing.

### Entry points

| Where | What it opens |
| --- | --- |
| Header terminal icon (any module) | Local shell quick-panel tab (unchanged) |
| Header console icon (any module) | Dedicated Console workspace (`cloudView = 'console'`) |
| Kubernetes resource table "View logs"/"Exec" | Quick panel, as before |
| Architecture Canvas / KUApps observability "View logs" | Quick panel, as before |
| AWS EC2 SSH row action (`AwsView.vue`) | `Ec2Shell.vue` modal, now store-backed (see #39 below) |
| AWS EC2 RDP row action (`AwsView.vue`) | `Ec2Rdp.vue` modal, still outside the shared store (untouched, see #39) |
| Console workspace EC2 SSH launcher | Creates/reuses the same store tab as the `Ec2Shell.vue` modal, for the same host/user/profile |
| Console workspace AWS SSM launcher | Creates/reuses a store tab driving `/ws/aws-ssm` (see #41 below); disabled with an install hint if `session-manager-plugin` isn't detected |

The header buttons live in `App.vue`'s `.header-right`, in the tail that renders
regardless of `activeProvider` — reachability from every module is structural
(the button is simply always in the DOM), not a per-module wiring decision.

## EC2 SSH joins the shared registry, RDP does not (#39)

`Ec2Shell.vue` no longer owns its connection: it creates/reuses a `useTerminalStore`
tab via `openCloudTab('ec2', label, { profileId, target })` and drives it with a new
`startSshStream(tab)` in `useTerminalStreams.js` — same shape as `startLocalStream`.
`openCloudTab` now dedups on `(type, target.host, target.user, profileId)`, mirroring
`openLocalTab`'s existing dedup pattern, so opening the same host/user/profile from
`AwsView.vue`'s per-instance button and from the Console workspace's launcher converges
on one session instead of two independent SSH connections. The component's own UI
(command history, clipboard, Ctrl+C/D, connect form) is unchanged — only its state
ownership moved to the shared tab, reusing `store.pushLine` for output formatting
instead of a bespoke per-component formatter (a small, intentional side effect: SSH
output now gets the same content-based line classification — error/warning highlighting
— that local/exec/log tabs already have, and the command-echo prompt glyph is now the
same color as the rest of the echoed line instead of a separate accent color).

**RDP is out of scope.** `Ec2Rdp.vue`/`/ws/ec2-rdp` are canvas/bitmap streaming (mouse
and key events, not a text/command tab) and don't fit the shared registry's text-tab
model — left exactly as-is.

**Backend transports are unchanged.** All of `/ws/shell`, `/ws/logs`, `/ws/exec` and
`/ws/ec2-shell` already worked correctly through the shared registry before this ticket
(as of #37/#38); this work is entirely frontend wiring for EC2, not a backend protocol
change. Their message shapes have some pre-existing inconsistencies, documented as
accepted below rather than silently changed:

| Transport | `done` includes `code`? | `error.data` detail | Resize support |
| --- | --- | --- | --- |
| `/ws/logs` | Never sends `done` (follow-mode; ends via client `stop` or socket close) | Full message | N/A |
| `/ws/exec` | Yes | Full message | No pty to resize |
| `/ws/shell` | Yes | Full message | Not implemented ("future node-pty") |
| `/ws/ec2-shell` | Yes | Generic fixed strings only (no SSH error detail forwarded) | Implemented server-side (`action:'resize'`), never sent by the frontend |

### Connection states

Normalized to: `idle → validating → (connecting|reconnecting) → connecting → connected`,
ending in one of `done` (clean backend-reported end), `error`, or `stopped` (explicit
`stopStream()`, e.g. the user closed the tab). `reconnecting` replaces `validating` only
when an existing tab with prior output is being reconnected (from `ConsoleWorkspaceView`'s
Reconnect action or a container/pod switch), so the UI can distinguish "first connect"
from "retrying an existing session." A `done`/`error` already recorded from a message is
never overwritten by the socket's subsequent `close` event.

### Troubleshooting

- **Tab stuck on "reconnecting"/"validating"**: the ticket POST (`/api/console/sessions`)
  is failing — check the browser console for a 400 (missing/invalid context) or 403
  (not same-origin/loopback).
- **"error" immediately after connecting**: for EC2 SSH, this is almost always a
  credential/host problem — the backend intentionally doesn't forward the underlying SSH
  error detail (see table above), so check the Env Manager profile and host/port.
- **Session shows "done" but you expected it to keep running**: the backend process
  exited (shell/exec) or the SSH session ended — this is a clean exit, not a dropped
  connection; reconnect to start a new one.

## AWS SSM Session Manager adapter (#41)

Unlike EC2 SSH (a raw socket), SSM Session Manager's interactive data channel is an
AWS-proprietary binary WebSocket protocol with no public spec and no AWS-SDK-for-JS
support. There is no maintained pure-JS reimplementation to depend on instead — the
only well-precedented path, and what `aws ssm start-session` itself does internally, is
shelling out to AWS's official `session-manager-plugin` binary. This is a new external
tool dependency (same detection pattern as kubectl/helm/gcloud/AWS CLI in
`routes/systemTools.js`), but for an interactive live session rather than a one-off
action — the Console workspace's SSM launcher checks `GET /api/system/tools` before
ever offering a Connect button, rather than only surfacing the plugin's absence as a
connection error after the fact.

**Architecture**: `lib/awsSsmBroker.js` is a small, dependency-injectable module (the
same testability pattern as `lib/consoleSessions.js`) with three functions —
`startSession` (resolves credentials via the same `resolveAwsConfig` every AWS route
uses, then calls `StartSessionCommand`), `spawnPlugin` (spawns `session-manager-plugin`
with the StartSession response as an argument and AWS credentials in the child's env,
never on argv), and `terminateSession` (best-effort `TerminateSessionCommand`, always
called on stop/close). `server.js`'s `/ws/aws-ssm` handler is a thin wrapper — same
shape as the EC2 SSH handler (`send`/`cleanup` closures, ticket-gated via
`consoleSessions.attach` like every other transport), just delegating the AWS/child-
process work to the broker.

**Message protocol** — deliberately identical to EC2 SSH's, so `useTerminalStreams.js`'s
`startSsmStream` is structurally the same function:
```
Client → server:  {action:'connect'} | {action:'stdin', data} | {action:'stop'}
Server → client:  {type:'connected', instanceId} | {type:'out'|'err', data}
                   | {type:'done', code} | {type:'error', data}
```
No `resize` support — the plugin runs under plain stdio pipes, not a pty, and nothing in
this ticket's requirements asks for it.

**Why a denied permission never orphans a session**: `StartSessionCommand` failing
(e.g. `AccessDeniedException`) never produces a `SessionId`, so there is nothing to
terminate and no plugin process is ever spawned. An explicit `stop`, or the WS closing
for any reason, always calls both `child.kill()` and `terminateSession()`.

**Minimum IAM policy** (scope `Resource` to specific instance ARNs where possible):
```json
{
  "Effect": "Allow",
  "Action": ["ssm:StartSession", "ssm:TerminateSession", "ssm:DescribeSessions", "ssm:GetConnectionStatus"],
  "Resource": "*"
}
```
Target-side requirements: the SSM Agent running on the instance, an instance profile
with `AmazonSSMManagedInstanceCore` (or equivalent), and network reachability to the
regional SSM endpoints (directly or via VPC endpoints in a private subnet).

**Cost note**: Session Manager itself has no additional AWS charge. The confirm dialog
before connecting is about opening a live interactive shell on a real instance — an
operational caution, not a billing one — and the UI copy says so plainly rather than
overstating cost.

## GCP and Vercel adapters (#42)

Related Architecture work (not duplicated here): #19 built GCP/Vercel *discovery*
(`lib/architecture/gcpDiscoveryReader.js`/`vercelDiscoveryReader.js`) — this ticket
reuses its exact auth resolvers (`resolveGcpAuth`/`resolveVercelAuth` from
`routes/gcp.js`/`routes/vercel.js`) the same way those readers already do, but doesn't
touch discovery/preview/import.

**Why no GCP interactive shell**: Cloud Shell is a per-user, browser-driven VM tied to
interactive end-user OAuth — there is no service-to-service API to start one on behalf
of a stored service-account credential (this app's only GCP auth model). GCP Compute
SSH via IAP tunneling is technically real but a bigger lift than SSM: no installed
library, and either shelling out to `gcloud compute start-iap-tunnel` or hand-rolling
the relay protocol, *plus* `ssh2` on top once tunneled. Both stay out of this ticket —
`gcp-shell` is marked `unavailable` (see below), IAP-tunneled SSH stays `planned`.

**A new registry status: `unavailable`**. Until now every capability was `available` or
`planned`; `gcp-shell` is the first `unavailable` entry, with a `reason` string the
launcher shows on hover instead of a bare "Planned" badge — the distinction matters:
`planned` means "not built yet, but buildable"; `unavailable` means "no path exists with
this app's current credential model."

**`gcp-logs` (Cloud Run only) and `vercel-logs`** are structurally one-way log tails —
the same shape as `/ws/logs` (Kubernetes), not `ec2-shell`/`aws-ssm`'s two-way
interactive shell — because that's what they actually are, and because both already
have working, already-authenticated, one-way implementations in this codebase to reuse
rather than reinvent:
- `lib/gcpLogsBroker.js` wraps the exact same Cloud Logging REST call already used by
  the one-off `GET /cloudrun/:region/:service/logs` route (`routes/gcp.js`), polling
  `entries:list` on an interval (`/ws/gcp-logs`, `{action:'start'|'stop'}` in,
  `{type:'log'|'error', data}` out, no `done` — follow-mode, same as `/ws/logs`).
  GKE, Compute serial, Cloud Functions, Cloud SQL and Workflows logs already have their
  own working snapshot endpoints in `routes/gcp.js` — same mechanical pattern (a
  different `resource.type` filter), deliberately not wired into the Console in this
  ticket, to keep it to one concretely working resource type.
- `lib/vercelLogsBroker.js` wraps the exact same upstream SSE call the existing
  `GET /deployments/:id/logs` route already makes, but parses the frames server-side
  instead of piping raw bytes to a browser `EventSource` — the line-extraction
  (`entry.text || entry.payload?.text || JSON.stringify(...)`) is copied verbatim from
  `VercelDeploymentLogs.vue`'s already-working parsing, not re-guessed at.

**Minimum IAM/OIDC**:
- GCP: `roles/logging.viewer` (or the narrower `logging.logEntries.list` permission),
  scoped to the project — the same service-account profile every other GCP route in
  this app already uses (`GCP_SERVICE_ACCOUNT_JSON` in the credential store, or a local
  `gcloud` CLI configuration).
- Vercel: an API token (`VERCEL_API_TOKEN`) with read access to the team/project's
  deployments — the same token every other Vercel route already uses.

**Troubleshooting**:
- **"error" right after starting a GCP Logs tab**: usually a permission or project
  mismatch — confirm the service account has `logging.logEntries.list` on the project
  and that the Cloud Run service/region names are exact.
- **Vercel tab shows an error immediately**: the deployment ID is wrong, or the token's
  team doesn't own that deployment — `teamId` is resolved from the profile, not typed by
  the user, so a token scoped to the wrong team will look like "deployment not found."
- **A GCP Logs tab never shows anything but doesn't error**: normal if the Cloud Run
  service simply hasn't logged anything since the tab connected — this is a live tail,
  not a snapshot; there is nothing to backfill before connect.

## Tab and history persistence (#40)

A reload restores tab organization without ever silently resuming a remote session or
writing anything sensitive to disk — the explicit anti-pattern this avoids is
`usePortForwardStore.js`'s `autoRestore()`, which re-establishes live port-forwards on
every reload with no confirmation.

**What's persisted** (`localStorage['kua:console:tabs']`, versioned): each tab's
descriptor fields only — `id, type, context, label, provider, environment,
applicationId, profileId, region, project, kubeContext, target, transport, ns, pod,
resourceType, containers, container, selectedPod` — plus tab order, the active tab id,
and the `wrap`/`height` preferences. **Never persisted**: the live `WebSocket`, raw
output (`entries`/`lines`/`_logBuffers` — this is where a command's secrets-looking
output would live), `connectionState`, or `capabilities` (recomputed from the registry
on restore). A restored tab always comes back with `connectionState: 'idle'` and no
`ws` — it renders as disconnected and requires an explicit Reconnect (now available
from both the quick panel's header and the Console workspace's row action).

**Command history** (`localStorage['kua:console:history']`, separate key): previously
two independent, non-persisted, not-per-target implementations (`Ec2Shell.vue`'s own,
and `TerminalPanel.vue`'s own — shared across every tab type with no target scoping).
Both now read/write the same store-level history, keyed per exact target so history
never crosses environments or resources:
- Kubernetes: `kubernetes:<kubeContext>:<namespace>:<resourceType>:<container>`
- Local: `local:<environment>:<applicationId>`
- EC2 SSH: `ec2:<host>:<user>:<profileId>`

Bounded at 200 commands per target (the number both prior implementations already
used) and 50 distinct targets total, evicting the least-recently-used target once
that's exceeded. Clearing is explicit and immediate: a per-tab "Clear history" action
in the quick panel, and a "Clear all history" action in the Console workspace header.

**Stale profiles/contexts don't block startup**: tabs restore optimistically, then
`App.vue` prunes any tab whose `profileId`/`kubeContext` no longer exists once the
fresh profile/context list loads — the same reconcile-after-load pattern already used
for the persisted AWS/GCP/Vercel profile selection, not a synchronous validity check
during store hydration.

## Release readiness (#43)

This closes the Console epic (#36-43). Every registered transport now has at least one
contextual, one-click entry point in addition to the dedicated workspace's manual
launcher — the gap this ticket closes was inconsistency, not a missing capability.

### Capability → entry point matrix

| Capability | Dedicated workspace launcher | Contextual entry point |
| --- | --- | --- |
| `local-shell` | Yes | Header terminal icon (any module) |
| `kubernetes-logs` / `kubernetes-exec` | Yes | Kubernetes resource table, Architecture Canvas, Observability |
| `ec2-ssh` | Yes (converges on the same tab) | `AwsView.vue` EC2 row "🖥 SSH" |
| `ec2-rdp` | No (stays in `Ec2Rdp.vue`, not in the shared registry) | `AwsView.vue` EC2 row "🪟 RDP" |
| `aws-ssm` | Yes | **New**: `AwsView.vue` EC2 row "⚡ SSM" |
| `gcp-shell` | N/A (`unavailable`) | N/A |
| `gcp-logs` | Yes | **New**: `GcpView.vue` Cloud Run "Logs" tab → "Open in Console" |
| `vercel-logs` | Yes | **New**: `VercelView.vue` deployment row → "Open in Console" |

**Explicitly not wired**: AWS Lambda has no registered capability (no interactive/log
transport exists for it in the registry), so no contextual action was added for it —
adding a button with nothing behind it would be worse than no button.
`ApmObservabilityView.vue`/`ApmApplicationLogs.vue`'s own resource-log lists were left
untouched: the same capability is already one click away from each resource's own
dedicated provider view, so a third entry point there would be redundant surface, not a
gap.

### Decision record: context threading and the `gcp-logs` required-field fix

**Problem:** `sessionDescriptor()` (`consoleSession.mjs`) has always generically lifted
`environment`/`applicationId` off whatever object it's given, and `auditSession()` has
always logged `session.environment` — but no caller ever actually passed those fields.
`App.vue`'s `openLogs`/`openExec` and `Ec2Shell.vue`'s `openCloudTab('ec2', ...)` call
only ever supplied `kubeContext`/`profileId`/`target`, so every Console session's audit
entry read `environment: 'default'` regardless of which real environment it targeted.

**Decision:** thread `environment`/`applicationId` from `store.linkedApplication`
(Architecture/Observability) or `activeApplicationContext` (`App.vue`'s
`useArchitectureContext`) through every existing and new session-opening call site, and
add `applicationId` to `auditSession()`'s logged `details` alongside the already-present
`environment`. No registry or `sessionDescriptor` changes were needed — this was a
caller-side gap only.

**Related fix, not a threading change:** `ArchitectureView.vue` had four
`application.provider || 'aws'` fallbacks that fire only once a linked application is
already confirmed to exist — a real record with a missing/legacy `provider` was silently
mislabeled as AWS instead of routing to `apmStore`/`ApmProviderMetrics` as unknown. These
now fall back to `'generic'`, matching the convention `App.vue`'s
`kuappsObservabilityProvider` already established for the same situation.
`useArchitectureContext.js`'s own `|| 'aws'` fallback was reviewed and left as-is: its
only caller (`AwsView.vue`'s bare-`projectId` `open-architecture` emit) is intentionally
AWS-only, and every other caller (`ApmObservabilityView.vue`, `GcpView.vue`,
`VercelView.vue`) already supplies an explicit `provider` — there is no live path where
it fires incorrectly today.

**Separate finding — `gcp-logs`'s required `project` was stricter than the code behind
it:** `resolveSession`'s GCP branch never reads `session.project`; it resolves the
project from the credential profile via `resolveGcpAuth` regardless
(`lib/gcpLogsBroker.js`'s own test suite already proved the broker tolerates a blank
project). But `validateSession()` rejected an empty `project` before a session could ever
reach that fallback — the existing "falls back to the resolved profile project" test
covered a path production traffic could never take. `project` is no longer in
`gcp-logs`'s `required` list; the workspace's GCP Logs form no longer requires it either,
and `GcpView.vue`'s new "Open in Console" button relies on this to avoid asking the user
for a project id the app never needed them to type for the equivalent inline "Logs" tab.

### Security / permissions / cost / observability checklist

- **Credentials**: every transport still resolves authority server-side from the
  existing credential store/profiles (SSH/RDP keys, AWS SDK config, GCP service account,
  Vercel API token) — nothing new is introduced by contextual wiring; see "Decision
  record: credentials, validation and audit" above for the full boundary.
- **Minimum IAM/permissions per provider**: AWS SSM (`## AWS SSM Session Manager adapter`
  above), GCP/Vercel (`## GCP and Vercel adapters` above) — unchanged by this ticket.
- **Audit**: every session now logs `provider`, `environment`, `applicationId` and
  `transport` — previously `environment`/`applicationId` were present in the schema but
  never actually populated by any caller.
- **Cost**: `gcp-logs` polls `entries:list` every 3s per open tab; `vercel-logs` and
  Kubernetes logs are push/stream, not polled. No change to SSM's plugin-process
  lifecycle (one `session-manager-plugin` child process per open tab, killed on
  stop/close, per the #41 section above).
- **Observability of the feature itself**: `docs/features/terminal.md` is the
  user-facing reference for every tab type below; this doc is the operator/developer
  reference.

### Release checklist

1. `node --test lib/*.test.js` — backend suite green.
2. `npx vitest run` (in `frontend/`) — frontend suite green.
3. `npx vite build` (in `frontend/`) — clean production build; revert the regenerated
   `public/` diff before committing (`public/` is committed build output, not part of
   source changes).
4. Manual: from a real AWS/GCP/Vercel profile, click each new contextual button
   (EC2 "⚡ SSM", Cloud Run "Open in Console", Vercel deployment "Open in Console") and
   confirm a Console tab opens and streams; confirm a GCP session connects with no
   project id typed in; inspect the audit log for a session opened from
   Architecture/Observability and confirm `environment`/`applicationId` are populated,
   not `default`/blank.
5. Link the GitHub Project
   (`https://github.com/users/lnavarrocarter/projects/1`) and issues #36-43 in the
   closing PR — the epic shipped incrementally across PRs #44/#46/#47/#55/#57/#58 and
   this one, not as a single `feature/global-console-foundation` branch.

## Validation

```sh
node --test lib/*.test.js
npm --prefix frontend test
(cd frontend && npx vite build) # verify only; revert the generated public/ diff after
```
