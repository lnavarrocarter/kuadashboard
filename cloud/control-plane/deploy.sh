#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-ncaicloud}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUD_RUN_SERVICE:-kua-control-plane}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/kua-control-plane/${SERVICE}:$(git rev-parse --short HEAD)"

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud artifacts repositories describe kua-control-plane --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create kua-control-plane --repository-format=docker --location="${REGION}" --description="KUA control plane images"

gcloud builds submit . --config=cloudbuild.yaml --project="${PROJECT_ID}" --substitutions="_TAG=$(git rev-parse HEAD)"

gcloud run deploy "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/kua-control-plane/${SERVICE}:$(git rev-parse HEAD)" \
  --platform=managed \
  --allow-unauthenticated \
  --min=0 \
  --max=3 \
  --memory=256Mi \
  --cpu=1 \
  --set-env-vars="NODE_ENV=production,GCP_DATABASE_MODE=datastore,CONTROL_PLANE_URL=https://api.kuadashboard.navarrocarter.com,FRONTEND_URL=https://kuadashboard.navarrocarter.com,GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-secrets="GOOGLE_CLIENT_ID=KUA_GOOGLE_CLIENT_ID:1,GOOGLE_CLIENT_SECRET=KUA_GOOGLE_CLIENT_SECRET:1,KUA_SESSION_SECRET=KUA_SESSION_SECRET:1,STRIPE_SECRET_KEY=KUA_STRIPE_SECRET_KEY:1,STRIPE_WEBHOOK_SECRET=KUA_STRIPE_WEBHOOK_SECRET:1,STRIPE_PRICE_PRO=KUA_STRIPE_PRICE_PRO:1,STRIPE_PRICE_TEAM=KUA_STRIPE_PRICE_TEAM:1"

echo "Cloud Run deployed: ${SERVICE} in ${REGION}"
