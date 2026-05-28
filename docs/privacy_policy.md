# Privacy Policy

Last updated: 2026-05-28

This Privacy Policy explains how KuaDashboard handles information when you use the desktop application, web interface, and cloud integrations.

## Scope

This policy applies to:

- KuaDashboard desktop app (Electron)
- KuaDashboard local web interface
- Integrations such as Vercel OAuth and cloud providers configured by the user

## Data We Process

KuaDashboard is designed to run primarily on your machine and process infrastructure metadata and credentials that you configure.

Depending on enabled features, KuaDashboard may process:

- Cloud resource metadata (for example service names, statuses, regions)
- Account identifiers required by provider APIs
- Credentials and tokens you provide
- Logs and command outputs you explicitly request in the UI

## Credential Storage

Credentials are stored locally using encrypted storage mechanisms supported by the runtime environment.

- In desktop environments, native secure storage/keychain may be used when available.
- In other environments, encrypted local storage may be used.
- You control which credentials are added, updated, or removed.

## Vercel OAuth Integration

When you use "Connect with Vercel":

- KuaDashboard uses your configured OAuth client credentials.
- OAuth access tokens are used only to call Vercel APIs needed by enabled features.
- Tokens are stored locally according to the credential storage mechanism described above.
- KuaDashboard does not sell OAuth data or tokens.

## Data Sharing

KuaDashboard does not broker or sell personal data. Data is shared only when required to execute actions you request against third-party providers (for example AWS, GCP, Vercel, Kubernetes APIs).

## Telemetry

KuaDashboard does not require centralized analytics to operate. If telemetry or diagnostics are ever introduced in a release, they should be documented and, where applicable, user-controllable.

## Security

Reasonable safeguards are implemented to reduce risk, including encrypted credential handling and local execution design. However, no method of storage or transmission is guaranteed to be 100% secure.

## Data Retention

Data retained by KuaDashboard is primarily local and under your control. You can remove profiles, credentials, and related local state from the application.

## Third-Party Services

Your use of integrated providers is also governed by those providers' own terms and privacy policies.

## Children's Privacy

KuaDashboard is not intended for use by children.

## Changes to This Policy

This policy may be updated as the product evolves. Material updates should be reflected in project documentation and release notes.

## Contact

For privacy questions, contact the project maintainer via the repository:

- [https://github.com/lnavarrocarter/kuadashboard](https://github.com/lnavarrocarter/kuadashboard)
