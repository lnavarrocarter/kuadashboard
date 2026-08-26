# Workspace Architecture: Fase 3

La fase 3 establece el workspace Architecture de AWS como una herramienta confiable de modelado basado en evidencia. Se considera completa cuando los criterios siguientes pasan en las suites soportadas y en una cuenta AWS real de validacion.

## Alcance

- Crear proyectos Architecture aislados por perfil.
- Descubrir recursos AWS mediante inventario regional y lecturas de solo lectura de CloudFormation.
- Previsualizar recursos y relaciones inferidas antes de cualquier mutacion.
- Importar una seleccion explicita de forma atomica con control optimista de revision.
- Reconciliar recursos redescubiertos por identidad AWS estable sin duplicar nodos historicos.
- Conservar decisiones manuales y relaciones rechazadas durante el redescubrimiento.
- Modelar con evidencia relaciones de API Gateway, Lambda, EventBridge, SQS, S3, IAM y Step Functions.
- Inspeccionar rutas APL y workflows ASL de Step Functions.
- Editar el grafo manualmente, ordenarlo por flujo o tipo de recurso y persistir la vista elegida.
- Crear snapshots, consultar historial, comparar revisiones y revertir de forma segura.

## Criterios De Aceptacion

| Area | Resultado requerido |
| --- | --- |
| Seguridad del discovery | Las operaciones AWS son de solo lectura, tienen presupuesto y exigen seleccion explicita. |
| Inventario | La importacion CloudFormation conserva todos los recursos soportados del stack sin aplicar el allowlist de APM. |
| Identidad | Reimportar los mismos recursos actualiza nodos existentes; IDs antiguos con el mismo ARN o identidad CloudFormation se reconcilian. |
| Revision humana | El redescubrimiento no sobrescribe relaciones inferidas aceptadas o rechazadas. |
| Atomicidad | Una importacion produce una revision del grafo y falla ante una revision esperada obsoleta. |
| Canvas | Posiciones, modo de orden, direccion y preferencia de etiquetas sobreviven a recargas y snapshots. |
| Navegacion | Las rutas API Gateway muestran metodo/ruta y permiten navegar a sus referencias Lambda. |
| Validacion | Pasan las pruebas del grafo backend, integracion HTTP, Canvas frontend y las suites completas. |
| Entorno real | Una cuenta AWS representativa permite previsualizar, importar, ordenar y redescubrir una aplicacion multi-stack sin crecimiento de nodos. |

## Contrato De Reconciliacion

El redescubrimiento es no destructivo. Agrega recursos nuevos seleccionados y actualiza coincidencias, pero no elimina un nodo existente solo porque no aparezca en una vista previa parcial o no haya sido seleccionado.

Un nodo descubierto coincide con uno existente mediante una identidad fuerte, en este orden:

1. ID exacto del grafo.
2. ARN de AWS.
3. Proveedor, cuenta, region, tipo e identidad nativa/discovery.
4. Proveedor, cuenta, region, stack, tipo y logical ID de CloudFormation.

Cuando duplicados historicos coinciden con el mismo recurso descubierto, se conserva el ID primario existente y se remapean aristas, grupos y posiciones. Las decisiones manuales de relaciones prevalecen sobre el nuevo estado inferido.

## Diferido A Fase 4

- Sincronizacion autoritativa de CloudFormation con revision de recursos nuevos, modificados y ausentes.
- Estado visible de sincronizacion, metadatos del ultimo discovery y ciclo de vida de recursos stale.
- Discovery desde codigo fuente, estado Terraform y GitOps.
- Discovery Architecture para GCP, Azure y multi-cloud.
- Capas de topologia operacional, recomendaciones y analisis asistido por IA.
- Automatizacion completa del navegador con credenciales AWS reales; fase 3 usa cobertura HTTP/componentes determinista y validacion manual en cuenta real.

## Evidencia De Cierre

La fase se cierra solo cuando la rama de release registra:

- Pruebas backend de Architecture aprobadas.
- Pruebas frontend de Architecture y build de produccion aprobados.
- Suites completas de backend y frontend aprobadas.
- Rediscovery limpio en un proyecto AWS multi-stack representativo.
- Fecha y resultado de validacion en el changelog.
