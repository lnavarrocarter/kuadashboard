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
| AWS | aws-ssm / ssm | profileId, region, target.instanceId | Planned |
| GCP | gcp-shell / cloud-shell | profileId, project | Planned |
| Vercel | vercel-logs / deployment-logs | profileId, target.name | Planned |

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
(`aws-ssm`, `gcp-shell`, `vercel-logs`) render disabled with no click handler at
all — the registry's `status` is the only thing gating them, so a newly
"available" capability lights up the launcher with no further UI change.

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

## Validation

```sh
node --test lib/consoleSessions.test.js lib/awsProfileResolver.test.js
npm --prefix frontend test -- useTerminalStore.test.js useTerminalStreams.test.js consoleCloudConnections.test.js ConsoleWorkspaceView.test.js
```
