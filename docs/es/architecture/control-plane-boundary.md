# Límite documental del Control Plane

KUA Desktop y KUA Control Plane son productos y repositorios separados. El repositorio desktop es responsable de la app local de operaciones; el repositorio privado `kua-control-plane` es responsable de identidad alojada, cobros, entitlements de cuenta y servicios cloud de la cuenta.

## Conservar en el repositorio Desktop

| Documentación | Motivo |
| --- | --- |
| `README.md`, guías de instalación e inicio | Explican cómo instalar y usar KUA Desktop o su interfaz web local. |
| `docs/features/` y descripciones de cuenta/planes para usuarios | Describen comportamientos visibles en la app. Explicar qué habilita un plan, no cómo lo concede el servicio. |
| `docs/privacy_policy.md`, `docs/terms.md`, `docs/EULA.md` y sus equivalentes en español | Son compromisos para usuarios y deben seguir accesibles desde el producto y el sitio. |
| `docs/changelog.md` y `docs/es/changelog.md` | Conservar el historial de cambios observables por usuarios. Al editar esas páginas, quitar o generalizar notas de despliegue que solo describen infraestructura. |
| Arquitectura desktop, API local y documentación Electron | Describen código que sigue en este repositorio; no confundir la API Express local con la API alojada del Control Plane. |
| La variable pública `KUA_CONTROL_PLANE_URL`, si sigue soportada para desarrollo local | Documentar solo su propósito y uso para pruebas locales; no exponer la configuración del despliegue del servicio. |

## Mover al repositorio privado Control Plane

Crear y mantener estos temas en `kua-control-plane/docs/` y enlazarlos desde el README de ese repositorio:

- Arquitectura del servicio alojado, límites de confianza, flujos de datos y contratos de API.
- Google OAuth, login desktop con PKCE, sesiones, entitlements, proveedores de cobro y webhooks.
- Datastore/Firestore y Cloud Storage, retención, cuotas, políticas TTL, firmas y claves KMS de equipos.
- Cloud Run, Cloud Build, IAM, dominios, Secret Manager, tareas programadas, envío de emails y procedimientos de despliegue.
- Operación de administración, respuesta a incidentes, diagnóstico y referencia interna de variables de entorno.

## Quitar o reescribir en la documentación pública Desktop

- Quitar credenciales, nombres de secretos junto con instrucciones operativas, configuración de consolas de proveedores, webhooks, detalles de tareas internas y procedimientos de infraestructura de producción.
- Sacar opciones solo de desarrollo, como `KUA_PLAN`, de las guías para usuarios y llevarlas a documentación para contribuidores. Si se mantienen, marcarlas claramente como reemplazos de desarrollo.
- Reemplazar los detalles de implementación o despliegue del Control Plane en el changelog o README público por un resumen visible para usuarios y un enlace al portal de cuenta. Conservar el historial funcional; no publicar runbooks privados.
- Mantener las páginas legales y de privacidad en el repositorio desktop. Describen el servicio alojado desde la perspectiva del usuario y no son documentación de implementación.

## Estado de la migración

Esta página define la propiedad documental; no borra ni mueve archivos. La próxima limpieza debe revisar el README público, ambos changelogs y ambas guías de configuración según esta tabla, manteniendo la documentación de la API desktop local. El README y `docs/` del repositorio Control Plane son la fuente de verdad para el comportamiento y la operación del servicio alojado.