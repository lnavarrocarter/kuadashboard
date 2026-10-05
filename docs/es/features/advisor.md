---
title: Advisor — Buenas prácticas, riesgos aceptados y evolución de la postura
description: Chequeos deterministas de buenas prácticas para AWS, GCP, Kubernetes y aplicaciones de KUApps en KUA, con hallazgos aceptados o silenciados y la evolución de la postura.
---

# Advisor

El **Advisor** revisa buenas prácticas con chequeos deterministas sobre datos que KUA ya tiene, o sobre APIs de control gratuitas: sin IA y sin llamadas con costo. Aparece en los resúmenes de AWS, GCP y Kubernetes (seguridad, infraestructura, arquitectura y desarrollo) y, con la mirada de producto, en cada aplicación de KUApps (objetivos, responsable, camino de release y telemetría).

El Advisor es parte de los planes **Pro** y **Team**. En Free muestra cuántos chequeos pasan y cuántos hallazgos hay por categoría y severidad, sin los recursos ni cómo corregirlos.

## Hallazgos y puntaje

Cada hallazgo muestra su severidad, los recursos afectados (hasta 10, con el total) y un enlace a la documentación del proveedor. El puntaje junto al título cuenta los chequeos que pasan sobre los que se pudieron ejecutar; las fuentes que KUA no pudo leer (por falta de permisos) se listan aparte, para que "todo bien" nunca se confunda con "no se pudo revisar".

Para pasarle los hallazgos a un agente de código, consulta [Agentes IA](./ai-agents).

## Aceptar o silenciar un hallazgo

Abre un hallazgo y elige:

- **Aceptar riesgo**: el equipo conoce el riesgo y se hace cargo (por ejemplo, un bastion SSH con IP pública detrás de una lista de IPs permitidas).
- **Silenciar**: el chequeo no aplica aquí (por ejemplo, un cluster de pruebas sin datos de producción).

Ambos requieren un **motivo** y aceptan un **vencimiento** opcional (30, 90, 180 o 365 días; los riesgos aceptados usan 90 por defecto). Se aplican a toda la regla o solo a los recursos que elijas, así un recurso nuevo que rompa la misma regla se sigue reportando.

Los hallazgos aceptados y silenciados:

- salen del puntaje: no cuentan ni como chequeos aprobados ni como fallidos;
- se listan aparte en **Aceptados y silenciados**, con el motivo, quién decidió y hasta cuándo, y un botón **Revocar**;
- vuelven como hallazgos cuando vence la aceptación. El resumen avisa de las aceptaciones que vencen en los próximos 7 días y de las que ya vencieron.

Cada decisión y revocación queda en el audit log (categoría *Advisor*) con su motivo. El autor es la cuenta KUA vinculada, o *local* si no hay una.

Las aceptaciones siguen a la cuenta o al cluster: una tomada para un perfil de AWS aplica en todas las regiones, y una para un contexto de Kubernetes en todos los namespaces. Las aceptaciones de una aplicación de KUApps viajan con ella en su KUAAppBundle (exportar, importar y sincronizar entre tus equipos).

## Evolución de la postura

El botón de gráfico junto al puntaje muestra la **evolución de la postura** de los últimos 90 días: el porcentaje de chequeos que pasan y la cantidad de hallazgos altos, de todas las categorías o de la seleccionada. Cada análisis suma un punto (los resultados idénticos dentro de una hora son un solo punto, así las actualizaciones automáticas no lo llenan); el historial se guarda un año, por perfil y región, proyecto, cluster y namespace, o aplicación.

## Alertas de postura

KUA compara cada análisis del Advisor con el anterior del mismo alcance y lista lo que cambió en la **campana** de la barra superior (Pro y Team):

- **Hallazgo nuevo**: un hallazgo alto o medio que antes no estaba.
- **Corregido**: un hallazgo que desapareció. Uno que salió porque se aceptó no cuenta como corregido.
- **La aceptación vence el…**: una aceptación que termina dentro de 7 días.
- **La aceptación venció**: el hallazgo volvió y cuenta de nuevo.

El primer análisis de un alcance es la base y no genera alertas. El mismo cambio alerta como mucho una vez al día, y las alertas se guardan 90 días. Al hacer clic en una se abre su resumen (el perfil de AWS o GCP, el resumen de Kubernetes o la aplicación de KUApps) y queda como leída.

Los hallazgos altos nuevos y las aceptaciones vencidas también generan una **notificación del sistema** (Windows, macOS, Linux). Se desactiva en **Ayuda y opciones → Opciones → Notificaciones de postura**; las alertas siguen en la campana. Las alertas comparan análisis que KUA ya hizo: nunca llaman por sí solas a un proveedor cloud.

## Análisis programado

Debajo de los hallazgos, **Análisis programado** hace que KUA analice ese alcance por su cuenta, así el historial y las alertas de postura avanzan aunque nadie tenga el resumen abierto: cada 6, 12 o 24 horas en Pro, y también cada hora en Team. Un análisis programado llama a la misma ruta que el resumen, así sus resultados coinciden con un escaneo manual.

| Resumen | Qué lee cada análisis | Costo |
| --- | --- | --- |
| AWS | Las mismas APIs de control que el resumen | Gratis |
| GCP | Unas 20 lecturas del resumen | Las listas de Storage y Secret Manager tienen costo: alrededor de USD 0,001 al mes cada 6 horas |
| Kubernetes | El cluster | Gratis. Corre mientras ese contexto sea el activo en KUA; si no, espera |
| KUApps | Datos que KUA ya tiene | Sin llamadas cloud |

El panel muestra el último análisis, el próximo, y por qué uno falló o está en espera. Cada cambio de una programación queda en el audit log.
