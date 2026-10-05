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
