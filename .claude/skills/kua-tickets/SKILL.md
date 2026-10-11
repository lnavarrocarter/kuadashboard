---
name: kua-tickets
description: Ciclo completo de tickets de KuaDashboard en GitHub (lnavarrocarter/kuadashboard) con las convenciones del equipo — abrir issues y épicas, dividir trabajo en sub-issues, crear rama, commits, rebuild del bundle, PR (incluido stacked), comentar avance, cerrar con resumen, actualizar el checklist de la épica, changelog y atender los issues automáticos "Deploy validation failed". Úsala siempre que el usuario hable de tickets, issues, épicas, PRs, "abre un ticket", "cierra el issue", "sigue con el #N", "qué falta de la épica", "sube esto", "haz el PR", "mergea", una auditoría/evaluación que haya que convertir en trabajo, o un fallo del pipeline de deploy, aunque no diga la palabra "ticket".
---

# Tickets de KuaDashboard

El repo es `lnavarrocarter/kuadashboard` (usa `gh`). El usuario lee en español, pero el código, los commits y los PR van en inglés. Esta skill recoge cómo trabajamos de forma constante; la intención es que cualquier sesión pueda retomar un ticket sin preguntar por el formato.

Plantillas exactas: `references/templates.md`. Léelas antes de escribir un issue, una épica, un PR o un comentario de cierre.

## Idiomas (no mezclar)

| Pieza | Idioma |
|---|---|
| Título y cuerpo de issues/épicas, comentarios de avance y cierre | Español |
| Rama, commits, título y cuerpo del PR, `docs/changelog.md` | Inglés |
| Textos de UI | Inglés primero, español segundo, siempre vía `t()` |

Las plantillas `.github/ISSUE_TEMPLATE/*` (`[BUG]`, `[FEATURE]`) son para usuarios externos; nosotros no las usamos.

## 1. Abrir un issue

1. Busca antes si ya existe: `gh issue list --state all --search "<palabras>"`. Si existe, actualízalo en vez de duplicar.
2. Título: `[Área] Frase que dice el resultado`. Áreas habituales: `KUApps`, `AWS`, `GCP`, `Vercel`, `Kubernetes`, `APM`, `Architecture`, `Endpoints`, `MCP`, `Desktop`, `Proveedores`, `Docker`, `Proxmox`, `SageMaker`, `AI chips`, `Kiro`, `Control plane`, `Contenedores`, `Extensibilidad`. Usa una existente antes de inventar otra.
3. Etiquetas (solo las que existen): `enhancement` o `bug` siempre; añade `frontend` si toca la UI, `security` si toca permisos, secretos, exposición o acciones destructivas, `documentation`, `control-plane`, `billing`, `infrastructure`, `release` cuando aplique.
4. Cuerpo con la plantilla de sub-issue (Objetivo, Alcance, Costos, Criterios de aceptación, Dependencias). La sección **Costos** es obligatoria cuando hay llamadas a APIs cloud: di qué llamada, su precio y si es desactivable; si no cuesta nada, dilo ("solo List/Describe, sin costo").
5. Nombra archivos reales (`lib/...`, `frontend/src/...`) cuando ya sepas dónde va el cambio; ayuda a quien lo retome.

## 2. Épicas

Cuando el trabajo tiene varias entregas independientes:

1. Crea primero los sub-issues, luego la épica con título `[Área] Resultado (épica)` y la plantilla de épica (Resultado de producto, Contexto, Camino de entrega, Fuera de alcance por ahora, Guardrails, Criterios de salida).
2. "Camino de entrega" es un checklist `- [ ] #N [Área] Título` en el orden en que se debe hacer.
3. Cada sub-issue termina con `Hijo de la épica #N` en Dependencias.
4. Lo que se evaluó y se descartó va en "Fuera de alcance por ahora" con el motivo, no se pierde.

Para una auditoría o revisión grande en un solo issue (estilo #239) también vale un issue con secciones numeradas por prioridad y checkboxes, más una sección "Conservar" con lo que no hay que romper.

## 3. Trabajar el ticket

1. Lee el issue completo y sus comentarios (`gh issue view N --comments`) y, si es hijo, la épica. Verifica en el código que el contexto sigue siendo cierto.
2. Rama desde `main` actualizado: `feat/<kebab>`, `fix/<kebab>`, `chore/<kebab>`, `docs/<kebab>`. Nunca trabajes en `main`.
3. Commits en inglés con Conventional Commits: `type(scope): frase que describe el comportamiento resultante`, no la acción del programador. Ejemplos reales:
   - `fix(kuapps): icons of the Resources tab and the inspector disappeared`
   - `feat(plans): Free limits apply from 2026-11-10, with an in-app notice until then`
   - `fix(gcp): failed reads are not zero, and expired credentials say how to renew them`
   Si el trabajo sigue una lista de hallazgos con códigos (G01, R03, A07…), pon el código al final: `(G04)`.
4. Tests: `npm test` (backend) y `npx vitest run` en `frontend/`. Anota cuántos pasan; van al PR.
5. Si cambió algo del frontend: `npm run build:frontend` y un commit aparte `chore(build): rebuilt bundle for <lo que cambió>`. Es el último commit antes del PR.
6. Changelog: entrada en `docs/changelog.md` bajo `## Unreleased` → `### Added` (o la sección que toque), en inglés, con **Título en negrita (#N):** y qué ve el usuario. Párrafo denso, sin viñetas internas.

## 4. Pull request

1. Título en inglés; normalmente igual al commit principal. Si agrupa varias cosas, una lista corta separada por comas.
2. Cuerpo según la plantilla: `## Summary` y `## Test plan` con checkboxes. Marcado `[x]` solo lo que ejecutaste de verdad (con el número de tests); lo manual que falta queda `[ ]`.
3. Enlace al issue en el cuerpo:
   - `Closes #N` cuando el PR completa el issue.
   - `Part of #N` cuando es una sección de un issue grande o de una épica.
   - `Refs #N` cuando solo está relacionado.
   Se pueden combinar: `Part of #146, Closes #155`.
4. PR apilado (stacked): primera línea `Stacked on #N (merge that first; this PR then retargets to \`main\`).` y base = rama del PR anterior.
5. Termina con la línea de atribución de Claude Code que indique el sistema.
6. Push y `gh pr create` solo cuando el usuario lo pidió o ya lo autorizó en esta sesión. Mergear también requiere su OK.

## 5. Seguimiento

- Cuando un PR cubre parte de un issue, comenta en el issue en español: `Avance:` + viñetas `**Sección X** en #PR: qué quedó`. Si apareció trabajo nuevo, añádelo como checklist en el mismo comentario en vez de abrir otro issue por cada detalle.
- Si el alcance cambió, edita el cuerpo del issue (`gh issue edit N --body-file`) para que refleje la realidad y dilo en un comentario; no dejes el issue describiendo algo que ya no se hará.
- Revisa el estado de una épica con `gh issue view <épica>` y cruza cada `#N` del checklist con su estado real.

## 6. Cerrar

1. Comprueba que el PR está fusionado en `main` y que los criterios de aceptación se cumplen.
2. Comentario de cierre en español: `Completado.` + qué se entregó y en qué PRs + `Todo fusionado en main.` (ver plantilla). Debe permitir entender qué se hizo sin abrir los PR.
3. Cierra: `gh issue close N --comment-file ...` (o deja que `Closes #N` lo cierre y añade el comentario después si falta).
4. Si es hijo de una épica, marca su casilla `[x]` en el cuerpo de la épica. Cierra la épica solo cuando todos sus criterios de salida estén cumplidos.
5. Si el ticket era relevante para el roadmap o una épica en memoria, actualiza la memoria correspondiente.

## 7. Issues automáticos "Deploy validation failed for PR #N"

Los crea `.github/workflows/pr-main-deploys.yml` cuando falla el pipeline (stages docs, electron, health check). No tienen etiquetas.

1. Lee el run enlazado: `gh run view <id> --log-failed`.
2. Si es un fallo real, arréglalo en una rama `fix/` o `chore/` y referencia el issue con `Fixes #N`.
3. Si es transitorio o ya se corrigió en un PR posterior, comenta la causa y el PR/commit que lo resolvió, y cierra. Varios issues del mismo PR se cierran juntos con el mismo comentario.

## 8. Trabajo que cruza con kua-control-plane

El backend de cuentas, planes, backups, sync y teams vive en `lnavarrocarter/kua-control-plane` (privado, tiene su propia skill `kua-control-plane-tickets`). Cuando un cambio necesita los dos lados:

- Abre un issue en cada repo y enlázalos con referencia completa: `lnavarrocarter/kua-control-plane#N` desde aquí y `lnavarrocarter/kuadashboard#N` desde allí.
- En el PR de aquí, indica qué necesita del otro lado y el orden de despliegue ("Deploy lnavarrocarter/kua-control-plane#42 first"). El control plane se despliega a producción al fusionar en su `main`, así que lo que el desktop espera del servidor debe estar desplegado antes de publicar el desktop.
- Valores que se reflejan en ambos lados (p. ej. `features`/`limits` de planes en `lib/plans.js` y `src/entitlements.js`) se cambian a la vez; deja un checkbox en el Test plan para el espejo si no se hace en esta sesión.

## Reglas transversales

- **Costos cloud:** cualquier llamada con cargo (CloudWatch `GetMetricData`, Cost Explorer, logs, S3 requests…) se declara en el issue y en el PR con su precio. No ejecutes llamadas facturables fuera del alcance sin confirmación.
- **Acciones destructivas** (detener, borrar) requieren confirmación por nombre y registro en el audit log; si un ticket las introduce, debe decirlo en Guardrails o Alcance.
- **Nada sale del equipo** del usuario salvo que el ticket lo diga explícitamente.
- Antes de cualquier acción visible en GitHub (crear, editar, comentar, cerrar, push, merge) di qué vas a hacer; si el usuario ya lo pidió explícitamente, hazlo y reporta el enlace.
