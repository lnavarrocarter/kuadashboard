# Privacy Policy

Last updated: 2026-10-03

This Privacy Policy explains how KuaDashboard handles information when you use the desktop application, the web interface, the cloud integrations and the optional KUA account.

The controller is Luis Ignacio Navarro Carter, a natural person based in Chile. Contact: [support@kuadashboard.navarrocarter.com](mailto:support@kuadashboard.navarrocarter.com).

## Scope

This policy applies to:

- KuaDashboard desktop app (Electron)
- KuaDashboard local web interface
- Integrations such as Vercel OAuth and cloud providers configured by the user
- The optional KUA account, its subscriptions and the KUA control plane (`api.kuadashboard.navarrocarter.com`)

## Data We Process

KuaDashboard is designed to run primarily on your machine and process infrastructure metadata and credentials that you configure.

Depending on enabled features, KuaDashboard may process:

- Cloud resource metadata (for example service names, statuses, regions)
- Account identifiers required by provider APIs
- Credentials and tokens you provide
- Logs and command outputs you explicitly request in the UI

## Local Application Observability

The optional application observability feature stores its data in a local SQLite database. It persists application configuration, confirmed resource identifiers, manual dependency edges, collection status, request-budget counters, thresholds, cursors, and 30-minute metric aggregates.

It does not persist raw CloudWatch log lines, request or response payloads, credentials, secrets, environment variables, or arbitrary resource tags. Candidate analysis uses inventory already loaded in the interface, returns only application-identity fields and scores, and does not create associations automatically.

APM metric buckets, cursors, and collection runs are deleted after 90 days. AWS request-budget records are retained for 15 months. Deleting an application cascades to its local APM data. Users can erase all APM history by closing KUA and deleting the local `apm-observability.sqlite3` database and its WAL companion files.

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

## KUA Account and Subscriptions

The KUA account is optional. Without an account, nothing about you leaves your computer except the calls you make to your own cloud providers.

When you sign in, the KUA control plane stores the following:

| Data | Why | How long |
|---|---|---|
| Google account id, email, name and profile picture URL | To identify your account | Until you delete the account |
| Sessions: a one-way hash of the session token, creation and expiry dates, and the client (web or desktop) | To keep you signed in | 30 days, or until you sign out |
| One-time desktop sign-in codes (hashed) | To link KUA Desktop safely | 5 minutes, used once |
| Subscription: plan, status, renewal date and Polar subscription and customer ids | To unlock your plan | Until you delete the account |
| Ids of the payment notifications received from Polar (no personal data) | To process each one once | 90 days |

We receive only your identity from Google. We do not receive or store Google access or refresh tokens, and KUA cannot read your Gmail, Drive or any other Google data.

The plan and the account name are cached on your computer for up to 7 days of offline use. The session token is kept in the operating system keychain.

**Payments.** Polar (polar.sh) sells the subscriptions as merchant of record. It collects your payment details, billing address and tax information under its own [privacy policy](https://polar.sh/legal/privacy). We never see or store card numbers. Polar keeps invoices for as long as tax law requires, even after you delete your KUA account.

**What never goes to the control plane:** cloud credentials, kubeconfigs, profiles, keys, logs, the local log cache, log intelligence data and resource inventories. These stay on your computer. Future cloud backups will only upload the sanitized application bundles you choose to back up, and this policy will be updated before they launch.

**Where the data is stored.** The control plane runs on Google Cloud in the United States (us-central1).

## Your Rights

You can ask to access, correct, export or delete your KUA account data, or object to its processing. These rights come from the Chilean data protection law (Law 19,628 and its amendments) and, where they apply to you, from laws such as the GDPR. Write to [support@kuadashboard.navarrocarter.com](mailto:support@kuadashboard.navarrocarter.com) and we will answer within 30 days. Deleting the account removes your user record, subscription record and all sessions. If a paid subscription is active, cancel it first so it is not renewed.

## Data Sharing

KuaDashboard does not broker or sell personal data. Data is shared only when required to execute actions you request against third-party providers (for example AWS, GCP, Vercel, Kubernetes APIs). For the KUA account, the processors are Google (sign-in and hosting) and Polar (payments).

## Telemetry

KuaDashboard does not require centralized analytics to operate. If telemetry or diagnostics are ever introduced in a release, they should be documented and, where applicable, user-controllable.

## Security

Reasonable safeguards are implemented to reduce risk, including encrypted credential handling and local execution design. However, no method of storage or transmission is guaranteed to be 100% secure.

## Data Retention

Data retained by KuaDashboard is primarily local and under your control. You can remove profiles, credentials, and related local state from the application. KUA account data is kept for the periods in the table above.

Feature-specific retention periods, including the application observability periods above, are enforced by local cleanup and do not affect data retained by third-party cloud providers.

## Third-Party Services

Your use of integrated providers is also governed by those providers' own terms and privacy policies.

## Children's Privacy

KuaDashboard is not intended for use by children.

## Changes to This Policy

This policy may be updated as the product evolves. Material updates are published on this page with a new date and in the release notes. If you have a KUA account, we will also tell you by email or in KUA.

## Contact

For privacy questions or to exercise your rights: [support@kuadashboard.navarrocarter.com](mailto:support@kuadashboard.navarrocarter.com).

See also the [Terms of Service and Subscriptions](/terms).
