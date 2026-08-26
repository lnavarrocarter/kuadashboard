# Plan de Gestion Unificada de KUA

## Decision de producto

KUA debe converger Observabilidad (APM) y Architecture alrededor de un concepto unico: una **KUA Application**.

Una KUA Application es el limite operativo de una aplicacion, entorno y perfil. Es el punto de entrada para:

- observabilidad en vivo y agregada;
- topologia explicable y diagramas de arquitectura respaldados por evidencia;
- deployments, fuentes y estado de discovery;
- revision de relaciones y analisis de topologia;
- trazas de procesos, hallazgos y futuras recomendaciones.

Esto no significa crear un diagrama para toda una cuenta cloud. Un proyecto sigue delimitando una aplicacion. Una plataforma grande puede contener varias KUA Applications, y una aplicacion puede extenderse por AWS, GCP, Vercel y Kubernetes.

## Por que converger

Hoy ambos espacios resuelven partes cercanas del mismo problema:

| Capacidad | APM actual | Architecture actual |
| --- | --- | --- |
| Objeto principal | Aplicacion | Proyecto de arquitectura |
| Membresia de recursos | Recursos confirmados para recolectar | Nodos descubiertos o agregados al grafo |
| Relaciones | Aristas confirmadas y sugerencias explicables | Aristas con evidencia y estado de revision |
| Datos operativos | Agregados metricos de 30 minutos, ejecuciones y salud | No almacena telemetria |
| Evidencia | Analisis por proveedor y ASL | Fuentes CloudFormation, snapshots y revisiones |
| Historial | Historial de recoleccion y retencion | Snapshots inmutables e historial de cambios |
| Contexto de trazas | Trazas AWS de Step Functions | Navegacion de rutas y workflows |

La duplicacion produce friccion: el usuario configura dos veces la misma Lambda, cola o carga Kubernetes; un hallazgo de topologia queda separado del diagrama que lo explica; y un recurso de Architecture puede no tener un propietario operativo claro.

## Arquitectura objetivo

### Propiedad canonica

La identidad de la aplicacion APM se convierte en la identidad canonica del producto unificado. El proyecto Architecture existente se vincula a esa identidad durante la migracion y luego pasa a ser una vista de arquitectura asociada a la aplicacion.

El modelo central debe ser neutral al proveedor:

```text
KUA Application
├── identidad: perfil, nombre, entorno, equipo
├── ambitos: AWS, GCP, Vercel, Kubernetes
├── recursos: identidades estables y configuracion operativa
├── relaciones: confirmadas, sugeridas, rechazadas, stale
├── fuentes: CloudFormation, labels, deployment, codigo, runtime
├── vistas: layout, grupos, filtros, snapshots
├── observabilidad: metricas, ejecuciones, salud y retencion
└── analisis: hallazgos, cobertura, trazas y recomendaciones
```

La identidad no debe depender del nombre visible. Como minimo debe incluir proveedor, perfil o conexion, cuenta/proyecto/contexto, region o ubicacion, identificador nativo (ARN, URL o UID de Kubernetes), tipo y version cuando aplique.

### Reglas de limite

- Una aplicacion no absorbe silenciosamente recursos de otra.
- Un recurso puede aparecer en varias fuentes de discovery, pero tiene una sola membresia canonica.
- La membresia manual y las decisiones humanas sobre relaciones nunca se sobrescriben.
- El discovery sigue siendo de solo lectura; la recoleccion sigue siendo opt-in y limitada por presupuesto.
- La telemetria sigue siendo local, agregada y limitada por retencion. No se persisten payloads, credenciales, secretos ni logs arbitrarios.
- Los snapshots de Architecture contienen topologia, no historial metrico ni payloads de trazas.
- Las relaciones entre proveedores requieren evidencia o confirmacion explicita; la similitud de nombres solo genera sugerencias.

## Experiencia de usuario

La navegacion principal debe pasar de dos modelos mentales a un solo espacio de aplicacion:

1. **Applications**: listado por entorno, equipo y salud.
2. **Overview**: salud, frescura, estado de recoleccion, puntuacion de topologia y hallazgos.
3. **Architecture**: diagrama, rutas, evidencia, cola de revision y snapshots.
4. **Resources**: membresia canonica, proveedor, ubicacion, recoleccion y lineage.
5. **Traces and events**: trazas por proveedor enlazadas a nodos y relaciones.
6. **Sync and review**: previews, recursos modificados/ausentes, ciclo stale y decisiones.

Las pestañas APM y Architecture actuales pueden mantenerse como accesos compatibles mientras ambas abren la misma KUA Application. Desde APM debe existir “Open architecture” y desde Architecture “Open observability”.

## Plan de entrega

### Fase 4B: terminar la sincronizacion autoritativa

Completar el trabajo CloudFormation ya iniciado antes de cambiar la propiedad:

- implementar `sync-apply` con `expectedRevision` y una sola revision atomica;
- persistir metadata de sync y conjuntos de stacks seleccionados;
- revisar por separado recursos nuevos, modificados, ausentes y stale, y relaciones;
- conservar decisiones manuales y rechazadas;
- agregar restauracion/eliminacion stale explicita;
- mostrar el detalle de la revision en la interfaz.

Criterio de salida: el sync multi-stack repetido es idempotente, los previews desactualizados son rechazados y ningun apply puede salir del alcance seleccionado.

### Fase 5: establecer el vinculo KUA Application

Agregar una asociacion no destructiva entre una aplicacion APM existente y un proyecto Architecture:

- agregar `architecture_project_id` o una tabla de vinculo equivalente;
- mapear recursos APM a nodos mediante identidades estables;
- mostrar recursos sin pareja, estado del vinculo y posibles duplicados;
- ofrecer “Crear vista de arquitectura” y “Vincular proyecto existente”;
- mantener legibles los endpoints y datos actuales durante la migracion;
- hacer reversible el desvinculado y no borrar automaticamente el otro lado.

Criterio de salida: el usuario abre una aplicacion y llega a diagrama, recursos, metricas y topologia sin configurar la membresia dos veces.

### Fase 6: registro compartido de recursos y relaciones

Converger ambas representaciones detras de un registro neutral al proveedor:

- un registro de recurso con configuracion operativa y lineage de discovery;
- un registro de relacion con evidencia, confianza y decision humana;
- adaptadores que proyectan el registro hacia los colectores APM y el grafo Architecture;
- cambios de membresia versionados y reconciliacion por fuente;
- identificadores de correlacion para metricas, trazas, eventos de deployment y nodos.

No mover buckets metricos, cursores ni payloads de trazas al documento del grafo. Los datos de alto volumen y sensibles a retencion permanecen en sus stores actuales.

Criterio de salida: import, edicion manual, analisis y colectores resuelven la misma identidad sin duplicar membresia.

### Fase 7: overlays operativos de arquitectura

Hacer el diagrama util durante incidentes y operacion diaria:

- indicadores de salud, frescura, datos parciales y recoleccion;
- sparklines metricos y resumen de errores al seleccionar nodos;
- resaltado de la ruta de una traza o correlation ID;
- marcas de deployment y stale con fecha;
- hallazgos navegables hacia nodo, relacion o evidencia;
- comparacion de snapshots separando topologia de telemetria.

Criterio de salida: el usuario pasa de una anomalia a su recurso, evidencia y traza reciente sin cambiar de workspace.

### Fase 8: adaptadores de proveedores y correlacion

Implementar proveedores detras de contratos compartidos, en este orden:

1. **Kubernetes**: contexto, namespace, UID, ownership de workloads/pods, Services, Ingress y eventos.
2. **GCP**: proyecto, region, Cloud Run, Cloud Functions, GKE y evidencia Cloud Monitoring.
3. **Vercel**: equipo/proyecto, deployment, dominio, funciones y actividad runtime.
4. **AWS ampliado**: mas tipos CloudFormation y fuentes de trazas cuando existan controles de privacidad y presupuesto.

Cada adaptador debe exponer discovery, identidad estable, evidencia de relaciones, señales de salud y capacidades. Si un proveedor carece de una capacidad, esa vista debe degradarse sin romper el workspace.

## Hoja de ruta de analisis

El motor debe combinar tres clases de evidencia sin tratarlas como equivalentes:

- **Declarada**: CloudFormation, ownership Kubernetes, manifests, configuracion Vercel y metadata de codigo.
- **Observada**: metricas, ejecuciones, eventos y trazas sanitizadas.
- **Inferida**: heuristicas de nombre/tipo o referencias no resueltas, siempre como sugerencias.

La puntuacion futura debe separar cobertura de topologia, salud operativa, frescura y confianza. Una puntuacion unica puede resumir, pero debe enlazar a hallazgos y datos parciales.

## Riesgos y controles

- Migracion: usar vinculos y compatibilidad de lectura antes de mover datos.
- Colisiones: exigir identidad fuerte y mandar coincidencias ambiguas a revision.
- Fuga de alcance: reforzar perfil, cuenta, proyecto, region y contexto en cada adaptador.
- Privacidad: conservar sanitizacion, agregacion, retencion local y payload bajo demanda.
- Diagramas saturados: ofrecer sub-vistas, filtros por proveedor y vistas de rutas.
- Acoplamiento: aislar la logica de proveedores en adaptadores.
- Verdad stale: mostrar ultimo sync correcto y antiguedad de evidencia.

## Metricas de exito

- Ningun recurso requiere configuracion duplicada entre observabilidad y Architecture.
- Un hallazgo APM abre su diagrama en una accion.
- Un nodo Architecture abre metricas y trazas en una accion.
- El discovery repetido conserva identidad y decisiones humanas.
- Toda relacion entre proveedores tiene evidencia o confirmacion explicita.
- Sync, recoleccion y analisis muestran frescura y estados parciales.
- AWS, GCP, Vercel y Kubernetes coexisten sin ramas especificas en el nucleo.

## Fuera de alcance de la fase actual

- Reemplazar los stores APM y Architecture en una sola migracion.
- Crear relaciones causales solo por similitud de nombres.
- Persistir logs crudos, payloads, credenciales o secretos.
- Discovery completo GCP, Vercel o Kubernetes dentro del hito CloudFormation.
- Remediacion generada por IA o cambios autonomos en produccion.
