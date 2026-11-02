# Release checklist: KUA 2.0 (and any later release)

Reproducible steps to publish a release. Written for 2.0 (issue #262, epic #266); replace the version numbers for later releases. Nothing here is done automatically: the owner decides when to publish.

Release order: **release candidate `v2.0.0-rc.1` first, then the final `v2.0.0` from the same commit (or a later `rc.N` if the rc needs fixes).**

## 0. Before anything: deploy order

1. Deploy `lnavarrocarter/kua-control-plane` **first** (plans, limits, Google OAuth, Pro/Team checkout and webhook). The desktop reads plans and limits from it, so a desktop release must never reach users before the server it expects.
2. Confirm prices and limits match in `lib/plans.js` (this repo) and the control plane. The Free limits apply from 2026-11-10.
3. Only then continue with this checklist. A rollback of the control plane is independent of the desktop; see section 6.

## 1. Preconditions

- [ ] `main` is green: `.github/workflows/pr-main-deploys.yml` (tests, docs build, Linux Electron build, health check) passed on the last PR; no open "Deploy validation failed" issue.
- [ ] Locally, on a clean checkout of `main`: `npm ci`, `npm ci --prefix frontend`, `npm ci --prefix docs`, then `npm test` (backend), `npx vitest run` in `frontend/` and `npm run docs:build`.
- [ ] Every child of epic #266 is closed, except #262.

## 2. Version bump (do on a `chore/release-2-0` branch, via PR)

Version fields. Keep them identical; the rc uses the same fields with the suffix (`2.0.0-rc.1`), the final removes it.

| File | What to change |
|---|---|
| `package.json` | `"version": "1.17.0"` → `"2.0.0"` (rc: `"2.0.0-rc.1"`). electron-builder and `app.getVersion()` read it; the installer is `KuaDashboard-Setup-<version>.exe` |
| `package-lock.json` | Same version at the top and in `packages[""].version`. Use `npm version 2.0.0 --no-git-tag-version` (it updates both) instead of editing by hand |
| `frontend/package.json` and `frontend/package-lock.json` | Currently `0.0.0` and never shown to users; leave as is unless the owner wants them aligned |
| `frontend/src/composables/useChangelog.js` | `CHANGELOG_VERSION = '2.0.0'`; rename the first entry `version: 'Unreleased'` to `'2.0.0'` and its `date` to `{ en: 'Month YYYY', es: 'Mes YYYY' }`. The WelcomeModal and StarNotice compare against this constant; `welcomeVariant` shows the 2.0 welcome only when the stored version is below 2 |
| `frontend/src/tests/ChangelogLocalized.test.js` | Expects `CHANGELOG[0]` to be `Unreleased` and `CHANGELOG[1]` to be `CHANGELOG_VERSION`: change to `CHANGELOG[0].version === CHANGELOG_VERSION` and drop the `Unreleased` assertion. Also review `HelpModal.test.js` (expects `1.17.0` in the first release) |
| `README.es.md` | Two lines: "Versión actual: **v1.17.0**" (line ~30) and "La versión actual es **v1.17.0**" (line ~199) |
| `plugins/kua/.claude-plugin/plugin.json` and `vscode/package.json` | `"version"` of the Claude Code plugin (#305) and the VS Code extension (#302). Users of the plugin stay on a version until it changes, so bump it with every release |
| `README.md` | No version number today; if a "Current version" line is added, bump it too |
| `docs/ROADMAP.md` | `> **Versión actual:** v1.17.0` |
| `docs/.vitepress/config.mjs` | Nothing to edit: `softwareVersion` is read from `package.json` |

Rebuild the frontend bundle after touching `frontend/` (`npm run build:frontend`) and commit it separately as `chore(build): rebuilt bundle for <change>`. `npm run electron:build:*` rebuilds it again in CI, but the repo tracks the bundle.

### Changelog

- [ ] `docs/changelog.md`: change `## Unreleased` into `## 2.0.0 (YYYY-MM-DD)` (the older entries use `## v1.17.0 (2026-09-28)`; keep the same style, `## v2.0.0 (YYYY-MM-DD)`). Keep the `### Upgrading from 1.x` section under it. Add a new empty `## Unreleased` above it for later work.
- [ ] `docs/es/changelog.md`: same change in Spanish (`## Unreleased` → `## v2.0.0 (YYYY-MM-DD)`).
- [ ] For the rc, leave both as `## Unreleased`; rename only for the final release, so the rc does not claim a date.

### Stale references to 1.x: to update at release time

Found by grepping README, docs and the app (excluding `node_modules`, `dist`, `public/assets`, `.vitepress/dist`, lock files, tests and the changelogs). Do **not** touch the entries that are historical on purpose.

Must change:

- `package.json:3`, `package-lock.json:3` and `:9`: `1.17.0`.
- `frontend/src/composables/useChangelog.js:14`: `CHANGELOG_VERSION = '1.17.0'`.
- `README.es.md:30` and `README.es.md:199`: "v1.17.0".
- `docs/ROADMAP.md:3`: "Versión actual: v1.17.0".
- `docs/growth-baseline.md:23` and `:54`: measurements of 1.17.0. It is a dated baseline; either leave it as history or add the 2.0 numbers next to it.
- `.github/workflows/release.yml:7` and `:9`: the manual workflow's example and default tag is `v1.7.0` (stale since 1.7; use `v2.0.0`). This workflow is manual only and is not the one used for releases; see section 4.
- `frontend/src/tests/ChangelogLocalized.test.js` and `HelpModal.test.js`: see the table above.

Review, probably leave:

- `docs/features/aws.md:10` and `docs/es/features/aws.md:10`: "v1.7.0 highlights" banner. Reword to a timeless sentence or "Since 1.7.0".
- `docs/guide/electron.md:92` and `docs/es/guide/electron.md:92`: example package name `kuadashboard_1.0.0_amd64.deb`; change to `<version>`.
- `docs/es/architecture/kua-unified-management-plan.md:80` and `docs/ROADMAP.md:22,29`: "Avance implementado: v1.14.x" headings. Historical, leave.
- `.github/ISSUE_TEMPLATE/bug_report.md:29` and `feature_request.md:28`: "(e.g. v1.3.0)" example; change to `v2.0.0`.
- `docs/architecture/kuapps-application-contract.md:132` and the `es` copy: `"version": "1.0.0"` is the contract/manifest version, not the app version. Leave.
- `docs/changelog.md` and `docs/es/changelog.md`: the "from 1.17" wording is the upgrade guide. Leave.
- `frontend/src/composables/useChangelog.js` older entries and the version numbers inside tests (`lib/mcp/*.test.js`, `frontend/src/tests/mcpSetup.test.js`, `WelcomeModal.test.js`) are fixtures. Leave.
- `docs/.vitepress/components/DownloadReleases.vue`: shows `releases[0]` (the newest non-draft release, **including** pre-releases, with a "Pre-release" badge). An rc will appear as the latest download on the website; accept it or filter `r.prerelease` before the final publish.

After the bump, run this to catch anything new (should only list history and fixtures):

```powershell
git grep -nE "1\.17\.0|1\.17\b" -- . ":!*package-lock.json" ":!docs/changelog.md" ":!docs/es/changelog.md" ":!*.test.js" ":!public/assets"
```

## 3. Tag naming

| Tag | Use |
|---|---|
| `v2.0.0-rc.1`, `v2.0.0-rc.2`, ... | Release candidates. The `-rc.N` suffix makes it a semver pre-release. The tag must equal `v` + the `package.json` version |
| `v2.0.0` | Final. Same commit as the last good rc plus the changelog rename |

Never reuse or move a tag that was published; cut `rc.N+1`.

## 4. What a tag triggers

`.github/workflows/electron-build.yml` ("Build & Release Electron App"):

- Trigger: `push` of any tag matching `v*`, or manual `workflow_dispatch` (input `draft`, default `true`; manual runs build `main` and publish a release named `dev-<timestamp>`, not a version tag, so use them only for dry runs).
- `build` job: matrix Windows (`*.exe`), macOS (`*.dmg`), Linux (`*.AppImage`/`.deb`) with Node 24, `npm ci`, icons, `config/runtime.env` from secrets (`VERCEL_OAUTH_CLIENT_ID/SECRET`), then `npm run electron:build:<platform>` with `ELECTRON_BUILDER_PUBLISH=never`. macOS is signed/notarized only when `CSC_LINK` and the Apple secrets exist; otherwise it builds unsigned with a warning.
- `release` job: downloads the artifacts, writes `SHA256SUMS.txt`, attests provenance, and publishes a GitHub Release with `softprops/action-gh-release` (`generate_release_notes: true`). Assets: installers, `latest*.yml` update manifests, and for pre-releases `rc*.yml`.
- Pre-release handling (this branch): the release is created with `prerelease: true` when the tag contains `-`, so `v2.0.0-rc.1` is flagged as pre-release and `v2.0.0` is not. Without that flag an rc would become the repository's "latest release" and every 1.17.x install would auto-update to it (see section 5).
- Update manifest names: electron-builder names the manifest after the version's pre-release id, so `2.0.0-rc.1` produces `rc.yml` / `rc-mac.yml` / `rc-linux.yml` instead of `latest*.yml`. The workflow uploads both patterns.

`.github/workflows/pr-main-deploys.yml` ("Ordered PR deploys"):

- Trigger: `pull_request` to `main` or manual. **A tag does not trigger it.** It runs `tests` → `docs` (VitePress build) → `electron` (Linux package + `/api/health` check), and `report_failure` opens a "Deploy validation failed" issue.
- It is the gate for the release PR; the tag build only starts after that PR is merged.

`docs.yml` (GitHub Pages) and `docs-vercel.yml` (SEO site) run on pushes to `main` that touch `docs/`; merging the version-bump PR publishes the website with the 2.0 changelog. For the rc, merge the bump with the changelog still as `Unreleased`, or accept that the site shows it.

`release.yml` is a manual, older workflow (`workflow_dispatch` with a `tag`); do not use it for 2.0.

### Publish procedure

1. Merge the version-bump PR to `main` and wait for the green gate.
2. `git checkout main && git pull`, then `git tag v2.0.0-rc.1` and `git push origin v2.0.0-rc.1`.
3. Watch the "Build & Release Electron App" run; confirm the release is marked **Pre-release**, lists the `.exe`, `.dmg`, `.AppImage`/`.deb`, `rc*.yml` and `SHA256SUMS.txt`, and verify the checksum of the `.exe`.
4. Test the rc (section 5). If it needs fixes, merge them and tag `v2.0.0-rc.2`.
5. For the final: rename the changelog (section 2), set `package.json` to `2.0.0` (`npm version 2.0.0 --no-git-tag-version`), merge, then `git tag v2.0.0 && git push origin v2.0.0`. Confirm the release is **not** marked pre-release and contains `latest.yml`.

## 5. Auto-update behaviour and how to test 1.17.x → rc on Windows

How the app updates (`electron/main.js`, `setupAutoUpdater`; `electron-updater` 6.8.3, GitHub provider from `package.json` → `build.publish`):

- The app calls `checkForUpdatesAndNotify()` at start and from the menu ("Check for Updates…"). `autoDownload` and `autoInstallOnAppQuit` are on; there are no dialogs, the renderer is told through `update:available` / `update:downloaded`.
- `allowPrerelease` and `channel` are **not set in the code**, so `electron-updater` uses its defaults: `allowPrerelease` is `true` only if the **installed** version itself has a pre-release part (for example `2.0.0-rc.1`), otherwise `false`.
- Installed **1.17.x** (stable): `allowPrerelease = false`, so it asks GitHub for `/releases/latest` and reads `latest.yml`. GitHub's "latest" never returns a release flagged pre-release, so an rc flagged correctly is **invisible to 1.17.x users**; they update only when the final `v2.0.0` is published. This is what we want for the public.
- Installed **rc** (`2.0.0-rc.N`): `allowPrerelease = true`, so it reads the releases feed, picks the newest tag, and uses the `rc` channel manifest (`rc.yml`). A rc moves to `rc.N+1` and to the final `2.0.0`.
- Consequence: a stock 1.17.x install will not receive the rc by itself, so the 1.17.x → rc test needs a forced channel (below). `allowDowngrade` stays `false`, so an rc never downgrades to 1.17.x.

Test on Windows (owner, manual):

1. Install the released 1.17.x installer (`KuaDashboard-Setup-1.17.0.exe` from the 1.17.0 release) on a Windows machine or VM and open it once so it creates its data directory.
2. Back up user data before testing (`%APPDATA%` folder of KuaDashboard).
3. Run the upgrade in two ways, because a stock 1.17.x never sees the rc:
   - a) **Installer over 1.17.x:** download `KuaDashboard-Setup-2.0.0-rc.1.exe` from the pre-release and run it over the 1.17.x install (NSIS upgrades in place). Confirm the app opens, keeps profiles and settings, shows the 2.0 welcome once, and reports `2.0.0-rc.1` in Help & Options.
   - b) **Updater from rc to rc:** with `rc.1` installed, publish `rc.2` and confirm `rc.1` receives `update:available`, downloads, and installs on quit or with "Restart to update".
4. For the true 1.17.x → 2.0.0 path (the public path), publish the final `v2.0.0`, keep a 1.17.x install, open it and confirm the update is offered, downloaded and installed; check `%APPDATA%\KuaDashboard\logs` (or the console started with `--enable-logging`) for `[updater] Update available: 2.0.0` and `Update downloaded`.
5. Check the SmartScreen prompt (the Windows build is only signed if `CSC_LINK` is configured) and that the app version in Help & Options reads the new version.

Open decision for the owner: if a one-click 1.17.x → rc test is wanted, a build-time or setting switch (`autoUpdater.allowPrerelease = true`) must be added in a future 1.17.x/2.0 build; until then option (a) is the supported test.

## 6. Rollback

- **Bad rc:** delete or mark the release as draft (`gh release edit v2.0.0-rc.1 --draft`) and delete the tag (`git push origin :refs/tags/v2.0.0-rc.1`) only if no one installed it; otherwise ship `rc.2`. Stable users never saw it.
- **Bad final, within minutes:** mark the `v2.0.0` release as pre-release or draft (`gh release edit v2.0.0 --prerelease`). `/releases/latest` then returns `v1.17.0` again, so 1.17.x clients stop updating. Clients that already installed 2.0.0 do not downgrade (`allowDowngrade` is false): they need a fixed `v2.0.1`.
- **Bad final, fix forward:** tag `v2.0.1` from a fix branch; the same pipeline publishes it and `latest.yml` points to it. This is the normal path.
- **Website:** revert the docs PR on `main`; `docs.yml` and `docs-vercel.yml` redeploy automatically. Restore the previous download page entry if needed.
- **Control plane:** roll back `lnavarrocarter/kua-control-plane` independently, but never to a version that no longer serves what 2.0 expects (plans, limits, checkout). Free limits apply from 2026-11-10 regardless of the desktop version.
- Never delete a published version tag that users already hold; add a new tag instead.

## 7. After publishing

- [ ] Comment the result on #262 and check its acceptance criteria; tick #262 in epic #266 and close both only when the rc test and the "no 1.x references" criterion are done.
- [ ] Add a new empty `## Unreleased` section to `docs/changelog.md`, `docs/es/changelog.md` and a matching `Unreleased` entry in `useChangelog.js`.
