# KUA Control Plane

Servicio independiente para identidad KUA, suscripciones y entitlements. No importa `server.js` ni accede a kubeconfigs, perfiles cloud o credenciales locales.

## Local

```bash
cp .env.example .env
npm install
npm test
npm start
```

Sin `GOOGLE_*` o `STRIPE_*` configurados, `/healthz` sigue disponible y los flujos protegidos responden `503`; esto permite ejecutar pruebas sin secretos.

Endpoints principales:

- `GET /auth/google/start` y `GET /auth/google/callback`: Google OIDC.
- `GET /api/me`: usuario y entitlements actuales.
- `GET /api/entitlements`: plan y funcionalidades habilitadas.
- `POST /api/billing/checkout`: crea un Checkout Session para `pro` o `team`.
- `POST /api/billing/portal`: abre el portal de facturación.
- `POST /webhooks/stripe`: actualiza la licencia desde eventos Stripe con firma e idempotencia.

## Google OAuth

Crear un OAuth Client de tipo Web y registrar:

`https://api.kuadashboard.navarrocarter.com/auth/google/callback`

El servicio solicita únicamente `openid`, `email` y `profile`. No almacena access tokens de Google; solo el identificador OIDC y datos mínimos de cuenta.

## Stripe

Crear dos precios recurrentes y guardar sus IDs en `STRIPE_PRICE_PRO` y `STRIPE_PRICE_TEAM`. Registrar el webhook:

`https://api.kuadashboard.navarrocarter.com/webhooks/stripe`

El webhook debe conservar el body crudo para verificar `Stripe-Signature`. Los eventos de suscripción son la fuente de verdad para habilitar o retirar entitlements.

## Persistencia y Cloud Run

Por defecto el servicio usa `GCP_DATABASE_MODE=datastore`, compatible con la base `(default)` Datastore que ya existe en `ncaicloud`. Si se crea una base Firestore Native separada, se puede cambiar a `GCP_DATABASE_MODE=firestore`.

Para Datastore, el service account de Cloud Run necesita `roles/datastore.user`. Para Firestore Native, usa el rol equivalente de acceso a datos de Firestore.

La ejecución prevista es `us-central1`, con escala a cero y máximo de tres instancias:

```bash
./deploy.sh
```

Antes del primer despliegue, crear el repositorio de Artifact Registry, la base Firestore y estos secretos en Secret Manager:

`KUA_GOOGLE_CLIENT_ID`, `KUA_GOOGLE_CLIENT_SECRET`, `KUA_SESSION_SECRET`, `KUA_STRIPE_SECRET_KEY`, `KUA_STRIPE_WEBHOOK_SECRET`, `KUA_STRIPE_PRICE_PRO`, `KUA_STRIPE_PRICE_TEAM`.

Conceder al service account de Cloud Run acceso mínimo a Firestore y `roles/secretmanager.secretAccessor`. No poner los valores en `cloudbuild.yaml`, GitHub Actions ni `.env.example`.

El servicio debe quedar público a nivel Cloud Run para recibir OAuth y Stripe; la protección de datos la hacen las sesiones, autorización de aplicación y validación de webhooks.
