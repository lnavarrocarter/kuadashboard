# Plantillas

Copia la estructura; rellena con contenido concreto (archivos reales, APIs reales, números reales). Borra las secciones que no apliquen salvo **Costos** cuando haya llamadas cloud.

## Contenido

1. Sub-issue (español)
2. Épica (español)
3. Bug (español)
4. Comentario de avance (español)
5. Comentario de cierre (español)
6. Cuerpo de PR (inglés)
7. Entrada de changelog (inglés)

---

## 1. Sub-issue

Título: `[SageMaker] Advisor de SageMaker AI y herramienta MCP`

```markdown
## Objetivo
Una o dos frases: qué gana el usuario.

## Alcance
- Cambio concreto, con el archivo donde va (`lib/advisor/aws.js`).
- Otro cambio concreto.
- Qué integraciones existentes lo heredan (MCP, alertas, historial…).

## Costos
Qué llamadas hace, cuáles no tienen costo (List/Describe) y cuáles sí, con precio
(p. ej. CloudWatch `GetMetricData`: USD 0,01 por cada 1.000 métricas), cuántas por
ejecución, si se declara en la UI y si es desactivable.

## Criterios de aceptación
- [ ] Verificable 1 (tests, textos en inglés y español).
- [ ] Comportamiento degradado: sin permiso X, queda como "no evaluado" y lo demás funciona.

## Dependencias
Hijo de la épica #N; usa <otro issue o módulo>.
```

## 2. Épica

Título: `[AI] Capa de AI: Kiro, SageMaker AI y cómputo acelerado (épica)`

```markdown
## Resultado de producto
Un párrafo: qué podrá hacer el usuario cuando la épica termine.

## Contexto
- Qué hay hoy en KUA (con archivos).
- Por qué importa (riesgo, costo, demanda).
- Integraciones existentes que se reutilizan (#issue anterior).

## Camino de entrega
- [ ] #N [Área] Título del primer sub-issue
- [ ] #N [Área] Título del segundo sub-issue

## Fuera de alcance por ahora
- **Cosa evaluada**: por qué no ahora y cuándo se retomaría.

## Guardrails
- Solo APIs sin costo para inventario; lo que cuesta se declara en la UI.
- Ninguna acción destructiva sin confirmación por nombre y audit log.
- Nada sale de este computador.
- Textos en inglés primero y español después, vía `t()`.

## Criterios de salida
- [ ] Resultado observable 1.
- [ ] Resultado observable 2.
```

## 3. Bug

Título: `[Área] Lo que el usuario ve mal, en una frase` · etiquetas `bug` (+ `frontend` si aplica)

```markdown
## Qué pasa
Síntoma observado (captura o texto exacto del error).

## Cómo reproducir
1. …
2. …

## Esperado
…

## Causa (si se conoce)
Archivo y motivo.

## Criterios de aceptación
- [ ] Test de regresión que falla antes y pasa después.
```

## 4. Comentario de avance

```markdown
Avance:
- **Sección 1** en #240: lo que quedó resuelto, con la causa real si fue distinta de la sospechada.
- **Sección 2** en #241: …

Puntos adicionales encontrados (para la sección 3):
- [ ] Nuevo punto concreto.
```

## 5. Comentario de cierre

```markdown
Completado. <Qué se entregó, en una o dos frases con los detalles que importan
(archivos, comportamiento, tests)>. Sección 1 en #240; sección 2 en #241; … Todo fusionado en main.
```

## 6. Cuerpo de PR

```markdown
Stacked on #N (merge that first; this PR then retargets to `main`).   ← solo si está apilado

## Summary

Contexto en una frase (qué se reportó o qué pide el issue).

**Bloque 1** (si hay varios temas)
- Qué cambia y dónde (`lib/x.js`), dicho desde el comportamiento.
- …

**Fix found while testing** (si aplica)
- …

Closes #N   (o Part of #N / Refs #N)

## Test plan

- [x] `npm test`: 1063 passed, 0 failed, 1 skipped (new `lib/x.test.js`)
- [x] `vitest run` in `frontend`: 1385 passed (`Component.test.js`)
- [x] Bundle rebuilt with `npm run build:frontend`
- [ ] Manual: pasos concretos que quedan por probar a mano

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 7. Entrada de changelog

En `docs/changelog.md`, bajo `## Unreleased` → `### Added` (o `### Fixed`):

```markdown
- **Título corto de lo que ve el usuario (#N):** párrafo denso en inglés que dice qué cambia para el usuario, qué casos límite se cubren, qué no se hace (p. ej. "nothing changes in the cluster") y el costo si hay llamadas cloud.
```
