# Dependabot review — 2026-11-11

This change integrates the updates proposed in #393, #394, #395, #396, #397 and
#398 after fixing compatibility problems and resolving their shared lockfile.
OAuth replacement #389 remains separate because its deployed broker still
returns `503 VERCEL_OAUTH_UNAVAILABLE` until private configuration is supplied.

| PR | Update | Review result |
| --- | --- | --- |
| #393 | Ten Actions updates | Existing inputs and hosted-runner usage remain compatible. Docs and release jobs now use Node 24, matching the tested build runtime and the repository's minimum Node requirement. |
| #394 | Fifty compatible npm updates | The initial install had an ONNX download timeout; packaging consistently failed because Lucide changed its ESM filename. The subset now resolves the package's declared `module` entry through a Vite alias and includes five newly recognized icon names. Production assets are rebuilt. |
| #395 | Express 4 → 5 | The old action regex prevented startup; the unnamed SPA wildcard was also incompatible. Actions now have an explicit allowlist, the SPA wildcard includes root/nested routes, and extended query parsing preserves previous semantics. Real HTTP startup tests cover these paths and reject an unknown action. |
| #396 | Cloud Run client 1 → 4 | The application keeps its `v2` clients and injected GoogleAuth instance. Offline checks exercise path helpers, request protobuf serialization and list/get/update/revision response shapes. No Google resource was read or changed by those checks. |
| #397 | wait-on 8 → 9 | A real loopback server verifies HEAD polling through an initial 503 until HTTP 200, using Node 22. The existing CLI invocation remains supported. |
| #398 | keyring 1 → 2 | Provider failures now throw instead of looking like absent entries. Profile deletion keeps metadata on failure so it can be retried. Cache-key read failures cannot overwrite the keychain. Linux entries explicitly require persistent Secret Service storage. |

## Credential persistence

The keyring package's automatic Linux choice can fall back to kernel keyutils,
which is cleared on reboot. A shared entry factory now requests
`secret-service` for profile credentials, account secrets and cache keys. macOS
and Windows retain their native defaults. The service/account identifiers stay
the same so existing persistent entries remain addressable.

If Secret Service is unavailable, credential operations fail explicitly rather
than storing a supposedly persistent credential in kernel memory. Account and
cache storage keep their existing encrypted-file fallback. Profile metadata is
retained on a failed deletion. Five tests use simulated entries and temporary
files; they never read or write the user's actual keychain.

The packaged executable check additionally imports the real native keyring
binding on each platform. This verifies binary loading, not OS permission
prompts or a real credential round trip in every desktop environment.

## Validation

- Backend: 1,320 passing tests, including real HTTP startup/SPA/action checks
  and the five keyring persistence/error tests.
- Frontend: 1,489 passing tests; VS Code: 20 passing tests and successful VSIX.
- Frontend production build and VitePress build pass.
- The integration PR must pass CodeQL, ordered app/docs/Electron/health checks
  and the Windows/macOS/Linux installer/executable matrix before merge.
- Cloud Run checks use generated SDK objects with simulated transport calls;
  they do not substitute for testing a connected account against Google.
- The updater fixture checks metadata retrieval; signing, notarization and
  actual update installation remain release validation.

## npm audit after integration

Counts are affected packages, including inherited advisories, rather than
distinct exploitable defects. Commands run separately in each directory:
`npm audit --package-lock-only --json` and the same command with `--omit=dev`.

| Area | All moderate findings | Production moderate findings | High / critical |
| --- | ---: | ---: | --- |
| Root | 15 | 8 | 0 / 0 |
| Frontend | 5 | 0 | 0 / 0 |
| VS Code | 2 | 0 | 0 / 0 |
| Docs | 0 | 0 | 0 / 0 |

The frontend count was previously four. The fifth affected package is the
updated `@vue/test-utils`, inheriting the existing `js-beautify`/glob/minimatch
finding; it adds no production dependency or distinct advisory in this audit.
Remaining moderate findings continue in #392 and the
[original audit](./dependency-audit-2026-11-10.md).

The Vercel client secret remains an open release/security transition in #362.
The draft replacement has its own validation and requires private broker
configuration, a real connection, replacement release and subsequent rotation.

## Follow-up on #392

On 2026-11-11, the root lockfile audit was repeated after the Kubernetes/Google
transport migration. `npm audit --package-lock-only --omit=dev --json` reports
zero vulnerabilities. The full lockfile audit reports six moderate findings,
all through the Electron Builder/minimatch build chain; there are no high or
critical findings. The earlier nodemon/minimatch finding was removed by pinning
nodemon to 3.1.11, the last version outside the affected range. Npm's audit-fix
dry run confirms the remaining automatic fix would downgrade Electron Builder
from 26.18.x to 24.13.3 across a major version, so it is not applied without
cross-platform packaging validation. The builder finding remains tracked in
#392 pending a compatible upstream release and the package matrix.
