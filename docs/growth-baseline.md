# Visibilidad: validación de onboarding y línea base

Fecha de captura: **2026-10-10**. Repositorio: [lnavarrocarter/kuadashboard](https://github.com/lnavarrocarter/kuadashboard).

## Cambios de primera impresión

- README ES/EN: público objetivo, descarga directa, documentación y primera prueba antes del catálogo.
- Badges de release, compilación de escritorio y estrellas; el badge de compilación no representa cobertura de tests.
- Instalación desde código con compilación explícita del frontend y requisitos actualizados.
- Recorrido inicial de solo lectura, necesidad de entorno propio y advertencia de posibles cargos cloud.

## Validación técnica

Entorno: Windows, Node.js **v24.3.0**, npm **11.4.2**. Copia limpia local del commit `82e8dd5282d31eacd5535ea658956f78bdd2c702`, sin copiar `node_modules` ni credenciales. No se validó la descarga del repositorio por HTTPS.

| Paso | Resultado |
| --- | --- |
| `npm install` en la raíz limpia | Correcto: 949 paquetes añadidos |
| `npm install --prefix frontend` | Correcto: 250 paquetes añadidos |
| `npm run build:frontend` | Correcto: interfaz generada en `public` |
| `node server.js` con puerto libre y datos temporales | Correcto: HTTP 200 en `/api/health`, estado `healthy` |
| Interfaz servida desde la copia limpia | HTTP 200 en `/`, HTML con referencias a assets compilados |
| Instancia existente en `http://localhost:7193` | HTTP 200 en salud e interfaz, versión 1.17.0 |

El smoke de arranque ejecutó `node server.js`, no el wrapper `npm start` ni su hook `prestart`. No consultó recursos cloud. El proceso temporal se detuvo al terminar.

La recomendación de Node 22.12+ en la rama 22 LTS procede de los requisitos de Vite y better-sqlite3; la instalación ejecutada utilizó Node 24.3.0, no Node 22.

### Fricciones y riesgos

- Los README omitían `npm run build:frontend`: el servidor sirve `public`, no el código Vue directamente.
- Node 18 no cumple los requisitos actuales de las dependencias.
- Un `KUBECONFIG` explícito que apunta a un archivo inexistente impide arrancar (`ENOENT`). Al retirarlo, el arranque aislado sin kubeconfig pasó.
- npm informó 53 vulnerabilidades en la instalación raíz (2 bajas, 13 moderadas, 30 altas, 8 críticas) y 13 en frontend (1 baja, 2 moderadas, 10 altas). Son resultados agregados de auditoría, no una evaluación de explotabilidad. Requieren revisión separada; no se aplicó `npm audit fix`.
- La compilación advierte de chunks mayores de 500 kB. No bloqueó el build; falta medir el efecto sobre la primera carga.

### Pendiente antes de declarar onboarding completo

- Ejecutar `npm start` y su hook en un entorno limpio con Node 22 LTS.
- Validar instalación y primer arranque de los paquetes Windows, macOS y Linux.
- Confirmar carga visual e interacción en navegador desde la copia limpia; HTTP 200 no demuestra que la UI sea usable.
- Completar cinco primeras pruebas con usuarios voluntarios y permisos de lectura; registrar tiempo, bloqueos y resultado.
- Confirmar el segundo uso con tres usuarios voluntarios. No hay mediciones de activación o retención todavía.

## Línea base de GitHub

| Métrica | Valor | Alcance |
| --- | --- | --- |
| Estrellas | 5 | Instantánea del repositorio |
| Forks | 1 | Instantánea del repositorio |
| Issues abiertos + PR abiertos | 46 | Campo `open_issues_count`; no equivale a bugs |
| Releases publicadas | 31 | Excluye drafts |
| Descargas de assets | 489 | Acumulado de assets de releases publicadas |
| Descargas de assets de v1.17.0 | 24 | Release publicada el 2026-09-29 |
| Vistas de GitHub | 504 | Ventana devuelta por la API: 2026-09-25 a 2026-10-08 UTC |
| Visitantes únicos de GitHub | 4 | Misma ventana |
| Clones de GitHub | 2127 | Misma ventana |
| Clonadores únicos de GitHub | 512 | Misma ventana |

El tráfico es una ventana móvil, no un acumulado histórico. Los clones pueden incluir automatización; no son instalaciones. Las descargas incluyen todos los tipos de assets y no equivalen a personas ni usuarios activos. Los valores de vistas y clones corresponden a públicos y mecanismos distintos; no calcular conversión entre ellos.

Visitas web por canal, clics de descarga, activación y retención: **sin línea base disponible**, no cero. No se añadió telemetría a la aplicación.

## Seguimiento semanal

Responsable: por asignar. Próxima captura propuesta: **2026-10-17**.

Ejecutar con GitHub CLI autenticado y guardar fecha UTC, ventana y valores; tráfico requiere permisos sobre el repositorio:

```bash
gh api repos/lnavarrocarter/kuadashboard --jq '{stars: .stargazers_count, forks: .forks_count, open_issues_and_prs: .open_issues_count}'
gh api repos/lnavarrocarter/kuadashboard/traffic/views
gh api repos/lnavarrocarter/kuadashboard/traffic/clones
gh api repos/lnavarrocarter/kuadashboard/releases --paginate --jq '[.[] | select(.draft == false) | {tag: .tag_name, assets: [.assets[] | {name, download_count}]}]'
```

Para campañas futuras, usar enlaces a la web con `utm_source`, `utm_medium` y `utm_campaign` coherentes, y verificar que su herramienta de analítica registra esos parámetros antes de publicar. No asumir que GitHub atribuye tráfico a UTM.

| Fecha UTC | Canal | Pieza/enlace | Ventana | Visitas | Clics de descarga | Delta descargas | Pruebas completadas | Segundo uso | Bloqueos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-10 | GitHub | Línea base anterior a campaña | 2026-09-25 a 2026-10-08 | 504 | No medido | No aplica | No medido | No medido | Ver validación técnica |

Comparar descargas acumuladas mediante diferencias entre capturas. No sumar ventanas móviles de tráfico solapadas. Priorizar pruebas completadas y feedback útil sobre estrellas.
