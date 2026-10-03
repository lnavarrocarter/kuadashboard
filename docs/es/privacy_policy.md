# Política de privacidad

Última actualización: 2026-10-03

Esta política explica cómo KuaDashboard trata la información cuando usas la aplicación de escritorio, la interfaz web, las integraciones cloud y la cuenta KUA, que es opcional.

El responsable es Luis Ignacio Navarro Carter, persona natural con domicilio en Chile. Contacto: [support@kuadashboard.navarrocarter.com](mailto:support@kuadashboard.navarrocarter.com).

La versión en inglés ([Privacy Policy](/privacy_policy)) es la de referencia.

## Alcance

Esta política se aplica a:

- KuaDashboard de escritorio (Electron)
- La interfaz web local de KuaDashboard
- Integraciones como Vercel OAuth y los proveedores cloud que configures
- La cuenta KUA opcional, sus suscripciones y el control plane de KUA (`api.kuadashboard.navarrocarter.com`)

## Datos que tratamos

KuaDashboard funciona principalmente en tu equipo y trata los metadatos de infraestructura y las credenciales que tú configuras.

Según las funciones que actives, KuaDashboard puede tratar:

- Metadatos de recursos cloud (por ejemplo nombres de servicios, estados y regiones)
- Identificadores de cuenta que exigen las APIs de los proveedores
- Las credenciales y tokens que ingreses
- Los logs y las salidas de comandos que pidas en la interfaz

## Observabilidad local de aplicaciones

La observabilidad de aplicaciones es opcional y guarda sus datos en una base SQLite local. Guarda:
- la configuración de la aplicación;
- los identificadores de recursos confirmados;
- las dependencias que marques a mano;
- el estado de la recolección, los contadores de presupuesto de peticiones, los umbrales y los cursores;
- agregados de métricas cada 30 minutos.

No guarda líneas crudas de CloudWatch Logs, cuerpos de peticiones o respuestas, credenciales, secretos, variables de entorno ni etiquetas arbitrarias de recursos. El análisis de candidatos usa el inventario ya cargado en la interfaz, devuelve solo campos de identidad de la aplicación con su puntaje y no crea asociaciones por su cuenta.

Las métricas, los cursores y las ejecuciones de APM se borran a los 90 días. Los registros de presupuesto de peticiones de AWS se conservan 15 meses. Al borrar una aplicación se borran también sus datos de APM locales. Para borrar todo el historial de APM, cierra KUA y elimina la base local `apm-observability.sqlite3` junto con sus archivos WAL.

## Almacenamiento de credenciales

Las credenciales se guardan cifradas en tu equipo, con los mecanismos que ofrece el entorno:

- En escritorio se usa el llavero del sistema operativo cuando está disponible.
- En otros entornos se usa almacenamiento local cifrado.
- Tú decides qué credenciales agregas, cambias o eliminas.

## Integración con Vercel OAuth

Cuando usas "Connect with Vercel":

- KuaDashboard usa las credenciales del cliente OAuth que configuraste.
- Los tokens de acceso solo se usan para llamar a las APIs de Vercel que necesitan las funciones activas.
- Los tokens se guardan en tu equipo, con el mecanismo descrito arriba.
- KuaDashboard no vende datos ni tokens de OAuth.

## Cuenta KUA y suscripciones

La cuenta KUA es opcional. Si no la usas, ningún dato tuyo sale de tu equipo, salvo las llamadas que haces a tus propios proveedores cloud.

Cuando inicias sesión, el control plane de KUA guarda:

| Dato | Para qué | Cuánto tiempo |
|---|---|---|
| Id de la cuenta de Google, email, nombre y URL de la foto de perfil | Identificar tu cuenta | Hasta que borres la cuenta |
| Sesiones: un hash del token, el cliente (web o escritorio), las fechas de creación, última actividad y vencimiento y, en KUA Desktop, un id de dispositivo opaco (un hash, para que volver a iniciar sesión en el mismo equipo reemplace su sesión), el nombre del equipo, el sistema operativo, la arquitectura y la versión de KUA | Mantener tu sesión abierta y mostrar los dispositivos con sesión iniciada en la cuenta | 30 días, o hasta que cierres sesión |
| Códigos de un solo uso para iniciar sesión en el escritorio (como hash) | Vincular KUA Desktop de forma segura | 5 minutos; se usan una vez |
| Suscripción: plan, estado, fecha de renovación e ids de suscripción y cliente en Polar | Activar tu plan | Hasta que borres la cuenta |
| Ids de los avisos de pago recibidos de Polar (sin datos personales) | Procesar cada aviso una sola vez | 90 días |
| Backups en la nube (Pro y Team): los paquetes saneados de KUA Applications que elijas respaldar, con su nombre, aplicación, tamaño, checksum y fecha | Restaurarlos en cualquier equipo | Hasta que los borres o borres la cuenta |

De Google solo recibimos tu identidad. No recibimos ni guardamos tokens de acceso o de renovación de Google, y KUA no puede leer tu Gmail, tu Drive ni ningún otro dato de Google.

Tu plan y el nombre de tu cuenta quedan guardados en tu equipo para hasta 7 días de uso sin conexión. El token de sesión se guarda en el llavero del sistema operativo.

**Pagos.** Polar (polar.sh) vende las suscripciones como *merchant of record*. Polar recibe tus datos de pago, tu dirección de facturación y tu información tributaria, y los trata según su propia [política de privacidad](https://polar.sh/legal/privacy). Nosotros nunca vemos ni guardamos números de tarjeta. Polar conserva las facturas el tiempo que exige la ley tributaria, aunque borres tu cuenta KUA.

**Lo que nunca llega al control plane:** credenciales cloud, kubeconfigs, perfiles, llaves, logs, la caché local de logs, los datos de inteligencia de logs y los inventarios de recursos. Todo eso se queda en tu equipo. Los backups en la nube suben solo el paquete saneado de la aplicación que elijas respaldar (arquitectura, snapshots y metadatos del registro, sin ids de perfil, muestras de evidencia ni payloads de estado), y el servicio rechaza cualquier paquete con campos sensibles o valores con forma de credencial. Se guardan en un bucket privado de Google Cloud Storage; al borrar un backup o la cuenta se eliminan definitivamente.

**Dónde se guardan los datos.** El control plane funciona en Google Cloud, en Estados Unidos (us-central1).

## Tus derechos

Puedes pedir acceso a los datos de tu cuenta KUA, y también corregirlos, exportarlos o borrarlos, u oponerte a su tratamiento. Estos derechos vienen de la ley chilena de protección de datos (Ley 19.628 y sus modificaciones) y, cuando te correspondan, de normas como el RGPD. Escribe a [support@kuadashboard.navarrocarter.com](mailto:support@kuadashboard.navarrocarter.com) y te responderemos en un plazo de 30 días.

Al borrar la cuenta se eliminan tu registro de usuario, tu suscripción, todas tus sesiones y todos tus backups en la nube. Si tienes una suscripción de pago activa, cancélala primero para que no se renueve.

## Datos compartidos

KuaDashboard no intermedia ni vende datos personales. Solo se comparten datos cuando hace falta para ejecutar lo que pides a proveedores externos (por ejemplo las APIs de AWS, GCP, Vercel o Kubernetes). Para la cuenta KUA, los encargados del tratamiento son Google (inicio de sesión y hosting) y Polar (pagos).

## Telemetría

KuaDashboard no necesita analítica centralizada para funcionar. Si alguna versión incorpora telemetría o diagnósticos, se documentará y, cuando corresponda, podrás desactivarla.

## Seguridad

Aplicamos medidas razonables para reducir riesgos, como el cifrado de credenciales y la ejecución local. Aun así, ningún método de almacenamiento o transmisión es 100% seguro.

## Conservación de datos

Los datos que guarda KuaDashboard están sobre todo en tu equipo y bajo tu control: puedes eliminar perfiles, credenciales y el estado local desde la aplicación. Los datos de la cuenta KUA se conservan durante los plazos de la tabla anterior.

Los plazos de cada función, como los de la observabilidad de aplicaciones, se aplican con una limpieza local y no afectan a los datos que guarden tus proveedores cloud.

## Servicios de terceros

El uso de los proveedores integrados también se rige por sus propios términos y políticas de privacidad.

## Menores de edad

KuaDashboard no está pensado para menores de edad.

## Cambios a esta política

Publicaremos los cambios importantes en esta página, con una nueva fecha, y en las notas de versión. Si tienes una cuenta KUA, también te avisaremos por email o dentro de KUA.

## Contacto

Para consultas de privacidad o para ejercer tus derechos: [support@kuadashboard.navarrocarter.com](mailto:support@kuadashboard.navarrocarter.com).

Revisa también los [Términos de servicio y suscripciones](/es/terms).
