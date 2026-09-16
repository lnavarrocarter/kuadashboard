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

Connection states: `idle → validating → connecting → connected → closed`, or
`error`. Closing/restarting a pending tab invalidates its asynchronous attempt.
Sessions are not persisted; commands and output remain in existing memory-only
terminal buffers, not in the session descriptor.

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

## Validation

```sh
node --test lib/consoleSessions.test.js lib/awsProfileResolver.test.js
npm --prefix frontend test -- useTerminalStore.test.js useTerminalStreams.test.js consoleCloudConnections.test.js
```
