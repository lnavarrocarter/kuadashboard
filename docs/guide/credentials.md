# Credential setup

KuaDashboard stores named cloud profiles in its encrypted credential store. Open **Env Manager**, create a profile, select the provider, and enter the fields described below. Never commit credentials to the repository.

## Vercel

1. Create a token in [Vercel Account Tokens](https://vercel.com/account/tokens).
2. Create a Vercel profile in Env Manager.
3. Set `VERCEL_API_TOKEN` to the generated token.
4. For a team account, optionally set `VERCEL_TEAM_ID`. You can find the team ID in **Team Settings > General**.

The token must have access to the projects or team you want to manage. Vercel OAuth is also available in the Electron app.

Official reference: [Vercel access tokens](https://vercel.com/docs/rest-api/reference/welcome#authentication)

## GCP

Use a service account for stored profiles or a local `gcloud` configuration.

1. Create a service account in [Google Cloud IAM](https://console.cloud.google.com/iam-admin/serviceaccounts).
2. Grant only the roles required for the resources KuaDashboard will inspect or operate.
3. Create a JSON key and download it once.
4. Set `GCP_PROJECT_ID` and paste the full JSON into `GCP_SERVICE_ACCOUNT_JSON`.

Alternatively, run `gcloud auth login` and select the local configuration in KuaDashboard. Official references: [Create service account keys](https://cloud.google.com/iam/docs/keys-create-delete) and [IAM roles](https://cloud.google.com/iam/docs/understanding-roles).

## AWS

Prefer temporary credentials through IAM Identity Center (SSO) or a local AWS CLI profile. Run `aws configure sso` and `aws sso login --profile PROFILE`, then select the detected profile.

For a manual profile, set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`. Temporary STS credentials also require `AWS_SESSION_TOKEN`.

Grant least-privilege permissions. Official references: [AWS CLI authentication](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-authentication.html) and [IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

## Kubernetes

KuaDashboard reads kubeconfig from `KUBECONFIG`, `~/.kube/config`, imported YAML, or registered local paths.

1. Obtain a kubeconfig from your cluster administrator or cloud provider.
2. Verify it with `kubectl config get-contexts` and `kubectl auth can-i get pods --all-namespaces`.
3. Import the YAML or register its path from KuaDashboard.
4. Use a dedicated identity with the minimum RBAC permissions needed. Avoid embedding cluster-admin credentials.

Official references: [Organizing cluster access with kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/) and [RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/).