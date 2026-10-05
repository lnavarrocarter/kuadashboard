# Control Plane Documentation Boundary

KUA Desktop and the KUA Control Plane are separate products and repositories. The desktop repository owns the local operations app; the private `kua-control-plane` repository owns hosted identity, billing, account entitlements and cloud account services.

## Keep in the Desktop Repository

| Documentation | Keep because |
| --- | --- |
| `README.md`, installation and getting-started guides | They explain how to install and use KUA Desktop or its local web interface. |
| `docs/features/` and user-facing account/plan descriptions | They describe behavior users can see in the app. Explain what a plan enables, not how the service grants it. |
| `docs/privacy_policy.md`, `docs/terms.md`, `docs/EULA.md` and Spanish equivalents | These are user-facing commitments and must stay reachable from the product and website. |
| `docs/changelog.md` and `docs/es/changelog.md` | Keep release history for changes users can observe. Remove or generalize infrastructure-only deployment notes when those pages are next edited. |
| Desktop architecture, local backend API and Electron documentation | These describe code that remains in this repository; do not confuse the local Express API with the hosted Control Plane API. |
| The public `KUA_CONTROL_PLANE_URL` setting, if still supported for local development | Document only its purpose and local-test use; do not expose server deployment configuration. |

## Move to the Private Control Plane Repository

Author and maintain these topics in `kua-control-plane/docs/` and link them from that repository's README:

- Hosted service architecture, trust boundaries, data flows and API contracts.
- Google OAuth, desktop PKCE login, sessions, entitlements, billing providers and webhook behavior.
- Datastore/Firestore and Cloud Storage layout, retention, quotas, TTL policies, signatures and team KMS keys.
- Cloud Run, Cloud Build, IAM, domains, Secret Manager, scheduled jobs, email delivery and deployment procedures.
- Admin operations, incident response, service troubleshooting and internal environment-variable reference.

## Remove or Rewrite in Public Desktop Docs

- Remove credentials, secret names paired with operational instructions, provider dashboard setup, webhook setup, internal scheduler details and production infrastructure procedures.
- Move development-only switches such as `KUA_PLAN` out of end-user configuration guides into contributor documentation. Keep them only if clearly marked as development overrides.
- Replace Control Plane implementation/deployment detail in public changelog or README text with a user-visible summary and a link to the account portal. Preserve historical product behavior; do not publish private runbooks.
- Keep legal and privacy pages in the desktop repo. They describe the hosted service from the user's perspective and are not implementation documentation.

## Migration Status

This page defines ownership; it does not delete or move files. The next cleanup should review the public README, both changelogs, and both configuration guides against this table, then leave desktop-local API documentation in place. The Control Plane repository's README and `docs/` are the source of truth for hosted service behavior and operations.