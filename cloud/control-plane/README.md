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

## Proveedor de cobro

`BILLING_PROVIDER` elige el proveedor: `polar` o `stripe`. Por defecto usa Polar si hay `POLAR_ACCESS_TOKEN`, y si no, Stripe. Los planes (`free`, `pro`, `team`), lo que incluye cada uno y las rutas `/api/billing/*` son los mismos con ambos proveedores.

### Polar (proveedor principal)

Stripe no acepta cuentas de Chile. Polar actúa como *merchant of record*: cobra a los clientes, liquida el IVA y los impuestos de cada país, y paga al vendedor en Chile vía Stripe Connect Express (comisión aproximada de 5% + USD 0,50 por transacción). No hace falta constituir una empresa en el extranjero.

- **Productos:** uno por plan e intervalo, porque en Polar cada producto tiene un solo `recurring_interval`. KUA Pro cuesta USD 9 al mes o USD 90 al año, y KUA Team USD 29 al mes o USD 290 al año. Cada producto lleva la metadata `plan: pro|team`, que es la que decide el plan.
- **Checkout:** `POST /v1/checkouts/` con `external_customer_id` igual al id del usuario de KUA, así no hay que guardar el id de cliente de Polar.
- **Portal:** `POST /v1/customer-sessions/`. Un usuario que todavía no compró recibe un `400`.
- **Webhooks:** `POST /webhooks/polar`, verificados con Standard Webhooks sobre el body crudo. Se aceptan los secretos nuevos (`whsec_` en base64) y los antiguos de Polar. Eventos: `subscription.created|updated|active|canceled|uncanceled|revoked`. Una cancelación al fin del periodo mantiene el acceso hasta que llega `revoked`.
- **Integración sin SDK:** se usa la API REST con `fetch`, porque el SDK v1 de Polar solo trae módulos ES y este servicio es CommonJS.

Variables:

- `POLAR_SERVER`: `sandbox` o `production`.
- `POLAR_PRODUCT_PRO`, `POLAR_PRODUCT_TEAM`, `POLAR_PRODUCT_PRO_YEARLY` y `POLAR_PRODUCT_TEAM_YEARLY`.
- Secretos: `POLAR_ACCESS_TOKEN` (Organization Access Token con `products:write`, `checkouts:write`, `customer_sessions:write`, `webhooks:write` y `subscriptions:read`) y `POLAR_WEBHOOK_SECRET`.

En GitHub llevan el prefijo `KUA_`: `KUA_BILLING_PROVIDER`, `KUA_POLAR_SERVER`, `KUA_POLAR_PRODUCT_*`, `KUA_POLAR_ACCESS_TOKEN` y `KUA_POLAR_WEBHOOK_SECRET`.

**Estado (2026-09-29):** configurado en el **sandbox** de Polar. Hay cuatro productos, un webhook hacia `…run.app/webhooks/polar` con firma estándar y `BILLING_PROVIDER=polar`. Se verificó el circuito completo con un usuario de prueba:

1. `POST /api/billing/checkout` devuelve el checkout de Polar.
2. El pago con la tarjeta `4242 4242 4242 4242` dispara tres webhooks, todos con respuesta `200`, y `/api/entitlements` pasa a `pro`.
3. El portal de cliente responde `200`.
4. Al revocar la suscripción, el plan vuelve a `free`.

**Para pasar a producción:**

1. En polar.sh, verificar la identidad y conectar la cuenta de pagos.
2. Crear un token de producción y correr la misma configuración con `production`. Crea los productos y el webhook, y actualiza `KUA_POLAR_*` y `KUA_POLAR_SERVER=production` en GitHub.
3. Desplegar.

Mientras no exista el dominio `api.kuadashboard.navarrocarter.com`, el webhook apunta a la URL `run.app`. Cuando exista, hay que actualizar la URL del webhook en Polar.

### Stripe

Queda listo para cuando exista una empresa en un país que Stripe acepte (por ejemplo una LLC en EE.UU.); hoy está configurado en modo prueba.

Planes (modo prueba creado el 2026-09-29): **KUA Pro** USD 9/mes o USD 90/año y **KUA Team** USD 29/mes o USD 290/año (hasta 10 miembros). Cada precio tiene `lookup_key` (`kua_pro_monthly`, `kua_team_yearly`, …) y metadata `plan: pro|team`: el plan de una suscripción sale del precio, así un cambio de plan desde el portal se refleja aunque la metadata del checkout diga otra cosa.

Variables: `STRIPE_PRICE_PRO` y `STRIPE_PRICE_TEAM` (mensuales, requeridas para el checkout), `STRIPE_PRICE_PRO_YEARLY` y `STRIPE_PRICE_TEAM_YEARLY` (opcionales) y `STRIPE_PORTAL_CONFIGURATION` (configuración del portal `bpc_…`: tarjeta, facturas, cancelar al fin del periodo y cambiar entre planes). Registrar el webhook con los eventos `checkout.session.completed` y `customer.subscription.created|updated|deleted`:

`https://api.kuadashboard.navarrocarter.com/webhooks/stripe`

El webhook debe conservar el body crudo para verificar `Stripe-Signature`. Los eventos de suscripción son la fuente de verdad para habilitar o retirar entitlements.

## Persistencia y Cloud Run

El servicio usa `GCP_DATABASE_MODE=datastore` con una base propia: `GCP_DATABASE_ID=kua-control-plane` (modo Datastore, `us-central1`, protección contra borrado, sin integración con App Engine). Sin `GCP_DATABASE_ID` usa la base `(default)` del proyecto. Con una base Firestore Native, `GCP_DATABASE_MODE=firestore`.

Para Datastore, el service account de Cloud Run necesita `roles/datastore.user` (a nivel de proyecto cubre todas las bases). Para Firestore Native, usa el rol equivalente de acceso a datos de Firestore.

**Por qué no la base `(default)`** (investigado el 2026-09-29): la base `(default)` de `ncaicloud` es de 2022, está integrada con App Engine y **no acepta escrituras de nadie** (ni siquiera del dueño del proyecto): lecturas, consultas y `beginTransaction` funcionan, pero todo `commit` responde `403 PERMISSION_DENIED: Not authorized.`. Probablemente tiene activado el antiguo *Disable writes* de Datastore, que no se ve ni se cambia por API. Estaba vacía, así que el control plane pasó a su propia base. Costo: la capa gratuita de Firestore/Datastore solo aplica a `(default)`; con el tráfico del control plane son centavos al mes (≈ USD 0.18 por GB guardado y ≈ USD 0.1 por 100.000 escrituras).

La ejecución prevista es `us-central1`, con escala a cero y máximo de tres instancias:

```bash
./deploy.sh
```

El workflow `.github/workflows/control-plane.yml` despliega en cada push a `main` que toque `cloud/control-plane/**`. La configuración vive en GitHub:

- **Variables** (no sensibles): `KUA_GOOGLE_CLIENT_ID`, `KUA_STRIPE_PRICE_PRO`, `KUA_STRIPE_PRICE_TEAM`, `KUA_STRIPE_PRICE_PRO_YEARLY`, `KUA_STRIPE_PRICE_TEAM_YEARLY`, `KUA_STRIPE_PORTAL_CONFIGURATION`.
- **Secrets** (sensibles): `KUA_GOOGLE_CLIENT_SECRET`, `KUA_SESSION_SECRET`, `KUA_STRIPE_SECRET_KEY`, `KUA_STRIPE_WEBHOOK_SECRET`. El workflow los copia a Secret Manager solo cuando cambian (dejando una versión) y Cloud Run los lee desde ahí; si uno no está en GitHub pero ya existe en Secret Manager, se usa ese valor.

Lo que no esté configurado se omite y el servicio arranca sin esa función. Cuentas: el build corre como `kua-control-plane-deployer` (con `roles/logging.logWriter`, Artifact Registry y el bucket `ncaicloud-kua-control-plane-build`) y el servicio como `kua-control-plane-run` (`roles/datastore.user` y `roles/secretmanager.secretAccessor`).

El servicio debe quedar público a nivel Cloud Run para recibir OAuth y Stripe; la protección de datos la hacen las sesiones, autorización de aplicación y validación de webhooks.

## Problemas conocidos y cómo se resolvieron

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `gcloud builds submit` → `caller does not have permission to act as service account …/103280455503495732157` | Sin `serviceAccount` en `cloudbuild.yaml`, Cloud Build usa la cuenta de Compute por defecto (`306971032277-compute@…`), sobre la que el deployer no tiene `actAs` (y que tiene acceso de Editor). | `cloudbuild.yaml` corre el build como `kua-control-plane-deployer`, que tiene `roles/logging.logWriter` y `roles/iam.serviceAccountUser` sobre sí misma. |
| `The user is forbidden from accessing the bucket [ncaicloud_cloudbuild]` | `gcloud builds submit` sube el código al bucket por defecto. | `--gcs-source-staging-dir=gs://ncaicloud-kua-control-plane-build/source`. |
| Subida de 52 MiB / 5.581 archivos | Se enviaba `node_modules` (instalado por el job para los tests). | `.gcloudignore` (quedan 12 archivos). |
| `/healthz` devuelve el 404 de Google | Cloud Run responde por su cuenta las rutas que terminan en `z`. | `/health`. |
| Webhook de Stripe → 500 `7 PERMISSION_DENIED: Not authorized.` | La base `(default)` no acepta escrituras (ver arriba). | Base propia `kua-control-plane` y `GCP_DATABASE_ID`. Los 500 ahora quedan en Cloud Logging con su stack. |
| `--set-secrets` con versiones `:1` inexistentes | Seis secretos se crearon vacíos. | La configuración vive en GitHub y el workflow sincroniza Secret Manager (ver arriba). |

Permisos de la cuenta de despliegue: `roles/run.admin`, `roles/artifactregistry.writer`, `roles/cloudbuild.builds.editor`, `roles/serviceusage.serviceUsageConsumer`, `roles/logging.logWriter`, `roles/storage.admin` sobre el bucket de staging, `roles/iam.serviceAccountUser` sobre sí misma y sobre `kua-control-plane-run`, y `roles/secretmanager.secretAccessor` + `roles/secretmanager.secretVersionManager` solo sobre los cuatro secretos sensibles.

Pendiente: el dominio `api.kuadashboard.navarrocarter.com` todavía no responde por HTTPS (#33). Mientras tanto `CONTROL_PLANE_URL` es `https://kua-control-plane-306971032277.us-central1.run.app` (workflow y `deploy.sh`): ahí vuelven Google OAuth (`/auth/google/callback`, registrada en el cliente OAuth) y los webhooks. Al terminar #33, volver al dominio en ambos archivos y en el webhook de Polar.
