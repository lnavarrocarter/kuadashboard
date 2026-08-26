# Workspace Architecture: Fase 4

La fase 4 convierte el workspace Architecture de un flujo de importacion con preview en un flujo de sincronizacion autoritativa. El usuario sigue controlando las mutaciones, pero KUA puede explicar que cambio desde el ultimo discovery confirmado y guiar una actualizacion segura del diagrama.

## Objetivo

Hacer que los diagramas basados en CloudFormation se puedan mantener de forma continua sin perder revision humana, decisiones manuales de topologia ni contexto historico.

## Alcance

- Comparar una fuente seleccionada contra el grafo actual y clasificar recursos como nuevos, modificados, ausentes, sin cambios o manuales.
- Presentar una revision de sincronizacion antes de mutar el grafo.
- Registrar metadatos del ultimo discovery por fuente, incluyendo hora, perfil, cuenta, region, conjunto de stacks, cantidad de recursos y cantidad de relaciones.
- Marcar como stale los recursos descubiertos ausentes antes de eliminarlos, manteniendo explicito el ciclo de vida stale.
- Conservar decisiones de relaciones aceptadas y rechazadas durante la sincronizacion.
- Mostrar todos los cambios de relaciones despues de seleccionar recursos, incluyendo resultados automaticos y sugeridos.
- Soportar diagramas completos multi-stack como camino predeterminado para conjuntos de stacks CloudFormation.
- Preservar el contrato de seguridad de fase 3: discovery de solo lectura, confirmacion explicita, aislamiento por perfil y revisiones optimistas.

## Primer Hito

El primer hito de implementacion es la sincronizacion autoritativa CloudFormation para stacks seleccionados:

1. Ejecutar discovery para el conjunto de stacks seleccionado.
2. Comparar el preview con el grafo existente por fuente e identidad AWS fuerte.
3. Mostrar una revision agrupada por tipo de cambio de recurso y tipo de cambio de relacion.
4. Aplicar la sincronizacion aceptada como una sola revision del grafo.
5. Registrar metadatos de sync y exponerlos en la vista del proyecto.

## Estados De Sincronizacion De Recursos

| Estado | Significado | Accion predeterminada |
| --- | --- | --- |
| Nuevo | Esta en discovery pero no en el grafo. | Agregar tras confirmacion. |
| Modificado | Misma identidad con metadata visible, metadata de fuente o evidencia distinta. | Actualizar tras confirmacion. |
| Ausente | Antes fue descubierto desde la misma fuente, pero no aparece en el discovery actual. | Marcar stale primero. |
| Stale | Recurso ausente ya revisado como stale. | Mantener, restaurar o eliminar explicitamente. |
| Sin cambios | Misma identidad sin cambios relevantes de metadata. | No mutar. |
| Manual | Nodo creado por usuario o independiente de fuente. | Nunca lo cambia el sync. |

## Estados De Sincronizacion De Relaciones

| Estado | Significado | Accion predeterminada |
| --- | --- | --- |
| Nueva | La evidencia ahora soporta una relacion que no existe en el grafo. | Agregar como automatica o sugerida segun umbral. |
| Reforzada | Una relacion existente tiene evidencia nueva o mas fuerte. | Actualizar evidencia sin sobrescribir decisiones revisadas. |
| Evidencia ausente | Una relacion antes descubierta ya no esta soportada por la fuente seleccionada. | Marcar stale salvo que este confirmada manualmente. |
| Rechazada | El usuario rechazo esta relacion previamente. | Mantener rechazada y oculta en el canvas. |
| Manual | Relacion creada por usuario. | Nunca la cambia el sync. |

## Criterios De Aceptacion

| Area | Resultado requerido |
| --- | --- |
| Alcance de fuente | El sync CloudFormation solo evalua recursos del stack o conjunto de stacks seleccionado. |
| Revision | Ningun recurso nuevo, modificado, stale o eliminado muta el grafo sin confirmacion explicita. |
| Identidad | La reconciliacion por identidad AWS fuerte sigue siendo idempotente en syncs repetidos. |
| Decisiones humanas | Las relaciones manuales y rechazadas se conservan. |
| Ciclo stale | Los recursos descubiertos ausentes pasan a stale antes de eliminarse. |
| Metadata | Las vistas de proyecto y fuente muestran ultimo sync exitoso, cantidad de recursos y cantidad de relaciones. |
| Atomicidad | Un sync aceptado produce una revision del grafo y falla ante una revision esperada obsoleta. |
| Validacion | Pasan pruebas backend enfocadas de sync, integracion HTTP y flujo frontend de revision. |

## Diferido Mas Alla De Fase 4A

- Discovery desde codigo fuente y parsing estatico de dependencias.
- Comparacion de estado y plan Terraform.
- Reconciliacion GitOps con ArgoCD/Flux.
- Discovery Architecture para GCP, Azure y multi-cloud.
- Capas operacionales, recomendaciones y analisis asistido por IA.

## Evidencia De Cierre

La fase 4 se cierra cuando una aplicacion CloudFormation multi-stack representativa se puede sincronizar repetidamente con conteo estable de nodos, revision stale visible, decisiones humanas preservadas y suites enfocadas y completas aprobadas.