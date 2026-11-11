# Dependency security audit — 2026-11-10 (America/Santiago)

Issue: [#364](https://github.com/lnavarrocarter/kuadashboard/issues/364). Results were collected from npm for the lockfiles in this change. Counts are affected packages, including transitive dependants, rather than distinct exploitable defects.

## Scope and results

Commands: `npm audit --package-lock-only --json` and `npm audit --package-lock-only --omit=dev --json`, separately in the root, `frontend/`, `vscode/` and `docs/`. The baseline is main before this dependency change.

| Area | All before (low/moderate/high/critical) | All after | npm production before | npm production after |
| --- | --- | --- | --- | --- |
| root | 1/14/28/8 | 0/15/0/0 | 1/9/10/6 | 0/8/0/0 |
| frontend | 0/6/10/1 | 0/4/0/0 | 0/0/6/1 | 0/0/0/0 |
| vscode | 0/2/2/0 | 0/2/0/0 | 0/0/0/0 | 0/0/0/0 |
| docs | 0/2/6/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |

**Electron is a shipped runtime even though npm classifies it as a devDependency.** Electron 31 is outside the [official three-release support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). The selected target is 45.3.0, verified against the current npm stable release and the [Electron releases site](https://releases.electronjs.org/). The lockfile fixes the exact version; future supported releases must be reviewed through Dependabot and the packaging matrix.

## Reachability and remediation

| Surface | Input and assessment | Change / remaining work |
| --- | --- | --- |
| Desktop Chromium/Node and updater | The runtime renders the application and handles provider data; a dev-only npm label does not remove the shipped exposure. The old AppImage builder also affected generated installers. | Electron 45.3.0, builder 26.18.x, updater 6.8.11 and SQLite 13.0.3. Actual packaged-runtime tests check SQLite ABI, configured GitHub update provider and metadata retrieval using a loopback feed, without downloading or installing an update. |
| Kubernetes JSONPath / multipart / query parsing | The legacy auth providers evaluate configuration-selected JSONPath; multipart and query serialization are runtime paths. Treat their critical/high advisories as actionable. | Compatible client 0.22.3 removes the old JSONPath evaluator. Explicit same-major overrides select patched form-data 2.5.6+ and qs 6.17.1+. The move to the current fetch-based client remains a separate migration because it changes API signatures and response shapes. |
| Lambda ZIP reads | Lambda code readers in `routes/aws.js` and `lib/architecture/awsLambdaCodeReader.js` parse provider-returned ZIPs; malformed archive allocation is a reachable parser surface. | adm-zip 0.6.1 and updated lockfile. |
| HTTP, WebSocket, gRPC and XML dependencies | Runtime packages process responses or messages from configured providers and local API clients. Reachability depends on the specific advisory and provider input; no exploitation PoC was claimed for every inherited package. | Compatible fixes applied to Express/body-parser, ws, Google transport, protobuf and XML dependencies. No high or critical npm advisories remain. |
| Frontend PDF and Vue dependencies | jsPDF brings DOMPurify; the current architecture export uses drawing/text/images, and no application call to jsPDF.html was found. Vue server-renderer also runs during docs generation. Package presence alone is not proof of exploitation. | Sanitizer, Vue, js-yaml and other compatible fixes applied; shipped frontend rebuilt. Frontend production audit is clean. |
| VitePress development server | Vite/esbuild development endpoints affect authoring and preview environments, not a running server in the static published docs. | VitePress remains on stable 1.6.x, with a tested Vite 6.4.4+ override. Docs build succeeds and its audit is clean. |
| VS Code extension tooling | Azure sign-in and glob packages were dependencies of the packaging tool. Only jsonc-parser is a runtime dependency of the extension. | Compatible packaging-tool fixes; packaged VSIX and extension tests verified. Production audit is clean. |

## Remaining moderate advisories

These are retained findings, not assertions that moderate means harmless. No successful exploitation against KUA was demonstrated.

| Finding | Scope and evidence | Next action |
| --- | --- | --- |
| [request cross-protocol redirect SSRF](https://github.com/advisories/GHSA-p8p7-x288-28g6) | Runtime Kubernetes legacy transport. A malicious upstream redirect can cross protocol boundaries. The initial endpoint comes from the selected kubeconfig, but that is not a general SSRF fix. | Migrate the remaining request transport, with real HTTP fixtures for redirects, errors, auth, proxy behavior, exec, logs and watches. Do not globally disable TLS or replace the SDK without adapting its API. |
| [tough-cookie prototype pollution](https://github.com/advisories/GHSA-72xf-g2v4-qvf3) | Runtime via request. The advisory requires rejectPublicSuffixes=false; request constructs its CookieJar with looseMode=true and does not set that vulnerable option in the inspected path. Exploitation is not demonstrated in this configuration. | Remove with the request migration; retain the finding until the old package is absent. |
| uuid bounds check | Runtime Google/request dependencies. Inspected Google transport callers use v4 for multipart boundaries; the advisory concerns v3/v5/v6 with caller-provided buffers. No affected call was found in KUA. | Update the transport dependency family; do not force a major uuid override into legacy clients. |
| minimatch and glob | Build/development dependencies in builder, nodemon, frontend editor formatting and VSIX packaging. Inputs are project file paths; these packages do not enter the shipped extension or frontend production dependencies. | Track compatible upstream fixes with Dependabot; review major updates through the package/build matrix. |

## Validation and release limits

- Backend: 1,315 tests; frontend: 1,489 tests. VS Code tests and VSIX packaging, VitePress build and rebuilt production frontend pass.
- Linux: Electron 45.3.0 / embedded Node 24.22.2 package executes its SQLite and updater metadata smoke check.
- `.github/workflows/electron-security.yml` repeats packaging and the actual executable check on Linux, Windows and macOS. All matrix jobs must pass before merging this upgrade.
- Optional cpu-features and dtrace-provider accelerators use an incompatible NAN binding on current V8. The beforeBuild hook moves them into the excluded local dependency cache, preserving ssh2/bunyan JavaScript fallback; the normal SQLite rebuild continues.
- Updater validation checks configuration and a local test feed. Download, signature verification, installation, notarization and interactive GUI behavior still require release validation on the target platforms. The smoke test never queries the production update feed.
- Dependabot groups compatible npm changes and security updates across all five npm areas, plus Actions updates. CodeQL scans JavaScript/TypeScript on PRs, main and weekly.

## Package inventory

The following table accounts for every affected package in the initial four-area audit. Runtime classification uses the production audit, with Electron called out separately. Inherited advisories may appear in several packages for the same underlying defect.

| Area | Package | Initial severity | Execution | Current audit |
| --- | --- | --- | --- | --- |
| root | @electron/rebuild | high | development/build | no finding |
| root | @electron/universal | moderate | development/build | moderate |
| root | @grpc/grpc-js | high | runtime | no finding |
| root | @kubernetes/client-node | critical | runtime | moderate |
| root | @protobufjs/utf8 | moderate | runtime | no finding |
| root | @tootallnate/once | low | runtime | no finding |
| root | @xmldom/xmldom | high | development/build | no finding |
| root | adm-zip | high | runtime | no finding |
| root | app-builder-lib | high | development/build | moderate |
| root | axios | high | development/build | no finding |
| root | body-parser | high | runtime | no finding |
| root | brace-expansion | high | runtime | no finding |
| root | builder-util | high | development/build | no finding |
| root | builder-util-runtime | high | runtime | no finding |
| root | cacache | high | development/build | no finding |
| root | concurrently | critical | development/build | no finding |
| root | config-file-ts | moderate | development/build | no finding |
| root | dmg-builder | high | development/build | moderate |
| root | electron | high | shipped runtime (npm devDependency) | no finding |
| root | electron-builder | high | development/build | moderate |
| root | electron-builder-squirrel-windows | high | development/build | moderate |
| root | electron-publish | high | development/build | no finding |
| root | electron-updater | high | runtime | no finding |
| root | extract-zip | high | development/build | no finding |
| root | follow-redirects | high | development/build | no finding |
| root | form-data | critical | runtime | no finding |
| root | gaxios | moderate | runtime | moderate |
| root | glob | moderate | development/build | no finding |
| root | google-gax | moderate | runtime | moderate |
| root | ip-address | high | development/build | no finding |
| root | joi | high | development/build | no finding |
| root | js-yaml | high | runtime | no finding |
| root | jsonpath-plus | critical | runtime | no finding |
| root | make-fetch-happen | high | development/build | no finding |
| root | minimatch | moderate | development/build | moderate |
| root | moment | moderate | runtime | no finding |
| root | node-gyp | high | development/build | no finding |
| root | nodemon | moderate | development/build | moderate |
| root | protobufjs | high | runtime | no finding |
| root | proxy-addr | critical | runtime | no finding |
| root | qs | moderate | runtime | no finding |
| root | request | critical | runtime | moderate |
| root | retry-request | moderate | runtime | moderate |
| root | shell-quote | critical | development/build | no finding |
| root | source-map-js | high | runtime | no finding |
| root | tar | critical | runtime | no finding |
| root | teeny-request | moderate | runtime | moderate |
| root | tmp | high | development/build | no finding |
| root | tough-cookie | moderate | runtime | moderate |
| root | uuid | moderate | runtime | moderate |
| root | ws | high | runtime | no finding |
| frontend | @vitest/mocker | moderate | development/build | no finding |
| frontend | @vue/server-renderer | high | runtime | no finding |
| frontend | brace-expansion | high | development/build | no finding |
| frontend | dompurify | critical | runtime | no finding |
| frontend | editorconfig | moderate | development/build | moderate |
| frontend | glob | moderate | development/build | moderate |
| frontend | js-beautify | moderate | development/build | moderate |
| frontend | js-cookie | high | development/build | no finding |
| frontend | js-yaml | high | runtime | no finding |
| frontend | minimatch | moderate | development/build | moderate |
| frontend | nanoid | high | runtime | no finding |
| frontend | postcss | high | runtime | no finding |
| frontend | source-map-js | high | runtime | no finding |
| frontend | undici | high | development/build | no finding |
| frontend | vite | high | development/build | no finding |
| frontend | vitest | moderate | development/build | no finding |
| frontend | vue | high | runtime | no finding |
| vscode | @azure/identity | high | development/build | no finding |
| vscode | @azure/msal-node | high | development/build | no finding |
| vscode | @vscode/vsce | moderate | development/build | moderate |
| vscode | minimatch | moderate | development/build | moderate |
| docs | @vue/server-renderer | high | development/build | no finding |
| docs | esbuild | moderate | development/build | no finding |
| docs | nanoid | high | development/build | no finding |
| docs | postcss | high | development/build | no finding |
| docs | source-map-js | high | development/build | no finding |
| docs | vite | high | development/build | no finding |
| docs | vitepress | moderate | development/build | no finding |
| docs | vue | high | development/build | no finding |
