# Configurar credenciales

KuaDashboard guarda perfiles cloud con nombre en su almacén cifrado de credenciales. Abre **Env Manager**, crea un perfil, selecciona el proveedor y completa los campos indicados. Nunca guardes credenciales en el repositorio.

## Vercel

1. Genera un token en [Vercel Account Tokens](https://vercel.com/account/tokens).
2. Crea un perfil Vercel en Env Manager.
3. Ingresa el token en `VERCEL_API_TOKEN`.
4. Para una cuenta de equipo, agrega opcionalmente `VERCEL_TEAM_ID`. El ID aparece en **Team Settings > General**.

El token debe tener acceso a los proyectos o al equipo que deseas administrar. La aplicación Electron también permite autenticación OAuth.

Referencia oficial: [Tokens de acceso de Vercel](https://vercel.com/docs/rest-api/reference/welcome#authentication)

## GCP

Usa una cuenta de servicio para perfiles almacenados o una configuración local de `gcloud`.

1. Crea una cuenta en [Google Cloud IAM](https://console.cloud.google.com/iam-admin/serviceaccounts).
2. Asigna únicamente los roles necesarios para consultar u operar los recursos requeridos.
3. Crea una llave JSON y descárgala una sola vez.
4. Configura `GCP_PROJECT_ID` y pega el JSON completo en `GCP_SERVICE_ACCOUNT_JSON`.

Como alternativa, ejecuta `gcloud auth login` y selecciona la configuración local en KuaDashboard. Referencias oficiales: [Crear llaves de cuentas de servicio](https://cloud.google.com/iam/docs/keys-create-delete) y [Roles de IAM](https://cloud.google.com/iam/docs/understanding-roles).

## AWS

Prefiere credenciales temporales mediante IAM Identity Center (SSO) o un perfil local de AWS CLI. Ejecuta `aws configure sso` y `aws sso login --profile PERFIL`; luego selecciona el perfil detectado.

Para un perfil manual, configura `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_DEFAULT_REGION`. Las credenciales temporales de STS también requieren `AWS_SESSION_TOKEN`.

Asigna permisos de mínimo privilegio. Referencias oficiales: [Autenticación de AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-authentication.html) y [Buenas prácticas de IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

## Kubernetes

KuaDashboard lee kubeconfig desde `KUBECONFIG`, `~/.kube/config`, YAML importado o rutas locales registradas.

1. Obtén un kubeconfig del administrador del clúster o proveedor cloud.
2. Verifícalo con `kubectl config get-contexts` y `kubectl auth can-i get pods --all-namespaces`.
3. Importa el YAML o registra su ruta desde KuaDashboard.
4. Usa una identidad dedicada con los permisos RBAC mínimos necesarios. Evita credenciales con cluster-admin.

Referencias oficiales: [Organizar acceso con kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/) y [Buenas prácticas de RBAC](https://kubernetes.io/docs/concepts/security/rbac-good-practices/).