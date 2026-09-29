# KUA Control Plane

Servicio independiente para identidad KUA, suscripciones y entitlements. No importa `server.js` ni accede a kubeconfigs, perfiles cloud o credenciales locales.

## Local

```bash
cp .env.example .env
npm install
npm test
npm start
```

Sin `GOOGLE_*` o `STRIPE_*` configurados, `/health` sigue disponible y los flujos protegidos responden `503`; esto permite ejecutar pruebas sin secretos.

Endpoints principales:

- `GET /auth/google/start` y `GET /auth/google/callback`: Google OIDC.
- `GET /api/me`: usuario y entitlements actuales.
- `GET /api/entitlements`: plan y funcionalidades habilitadas.
- `GET /health`: estado del servicio (`/healthz` también existe, pero Cloud Run responde por su cuenta las rutas que terminan en `z`).
- `POST /api/billing/checkout`: crea un Checkout Session para `pro` o `team`, mensual o anual (`{ plan, interval: 'month' | 'year' }`).
- `POST /api/billing/portal`: abre el portal de facturación.
- `POST /webhooks/stripe`: actualiza la licencia desde eventos Stripe con firma e idempotencia.

## Google OAuth

Crear un OAuth Client de tipo Web y registrar:

`https://api.kuadashboard.navarrocarter.com/auth/google/callback`

El servicio solicita únicamente `openid`, `email` y `profile`. No almacena access tokens de Google; solo el identificador OIDC y datos mínimos de cuenta.

## Stripe

Planes (modo prueba creado el 2026-09-29): **KUA Pro** USD 9/mes o USD 90/año y **KUA Team** USD 29/mes o USD 290/año (hasta 10 miembros). Cada precio tiene `lookup_key` (`kua_pro_monthly`, `kua_team_yearly`, …) y metadata `plan: pro|team`: el plan de una suscripción sale del precio, así un cambio de plan desde el portal se refleja aunque la metadata del checkout diga otra cosa.

Variables: `STRIPE_PRICE_PRO` y `STRIPE_PRICE_TEAM` (mensuales, requeridas para el checkout), `STRIPE_PRICE_PRO_YEARLY` y `STRIPE_PRICE_TEAM_YEARLY` (opcionales) y `STRIPE_PORTAL_CONFIGURATION` (configuración del portal `bpc_…`: tarjeta, facturas, cancelar al fin del periodo y cambiar entre planes). Registrar el webhook con los eventos `checkout.session.completed` y `customer.subscription.created|updated|deleted`:

`https://api.kuadashboard.navarrocarter.com/webhooks/stripe`

El webhook debe conservar el body crudo para verificar `Stripe-Signature`. Los eventos de suscripción son la fuente de verdad para habilitar o retirar entitlements.

## Persistencia y Cloud Run

Por defecto el servicio usa `GCP_DATABASE_MODE=datastore`, compatible con la base `(default)` Datastore que ya existe en `ncaicloud`. Si se crea una base Firestore Native separada, se puede cambiar a `GCP_DATABASE_MODE=firestore`.

Para Datastore, el service account de Cloud Run necesita `roles/datastore.user`. Para Firestore Native, usa el rol equivalente de acceso a datos de Firestore.

La ejecución prevista es `us-central1`, con escala a cero y máximo de tres instancias:

```bash
./deploy.sh
```

El workflow `.github/workflows/control-plane.yml` despliega en cada push a `main` que toque `cloud/control-plane/**`. La configuración vive en GitHub:

- **Variables** (no sensibles): `KUA_GOOGLE_CLIENT_ID`, `KUA_STRIPE_PRICE_PRO`, `KUA_STRIPE_PRICE_TEAM`, `KUA_STRIPE_PRICE_PRO_YEARLY`, `KUA_STRIPE_PRICE_TEAM_YEARLY`, `KUA_STRIPE_PORTAL_CONFIGURATION`.
- **Secrets** (sensibles): `KUA_GOOGLE_CLIENT_SECRET`, `KUA_SESSION_SECRET`, `KUA_STRIPE_SECRET_KEY`, `KUA_STRIPE_WEBHOOK_SECRET`. El workflow los copia a Secret Manager solo cuando cambian (dejando una versión) y Cloud Run los lee desde ahí; si uno no está en GitHub pero ya existe en Secret Manager, se usa ese valor.

Lo que no esté configurado se omite y el servicio arranca sin esa función. Cuentas: el build corre como `kua-control-plane-deployer` (con `roles/logging.logWriter`, Artifact Registry y el bucket `ncaicloud-kua-control-plane-build`) y el servicio como `kua-control-plane-run` (`roles/datastore.user` y `roles/secretmanager.secretAccessor`).

El servicio debe quedar público a nivel Cloud Run para recibir OAuth y Stripe; la protección de datos la hacen las sesiones, autorización de aplicación y validación de webhooks.
