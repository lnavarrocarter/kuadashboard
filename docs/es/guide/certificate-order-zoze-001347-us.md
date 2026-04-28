# Documento de Soporte de Certificacion

## Certificate for Order: ZoZE/001347/US/

Fecha: 28 de abril de 2026  
Producto: KuaDashboard  
Tipo de software: Open Source (Codigo Abierto)

## 1. Proposito del documento

Este documento se emite para apoyar el proceso de certificacion asociado a la orden **ZoZE/001347/US/**, describiendo la naturaleza del software, su modelo de distribucion, medidas de confianza y cumplimiento tecnico.

## 2. Identificacion del software

- Nombre del producto: KuaDashboard
- Categoria: Plataforma de administracion unificada para Kubernetes, AWS y GCP
- Distribucion: Aplicacion de escritorio (Windows, macOS y Linux) basada en Electron
- Repositorio publico: https://github.com/lnavarrocarter/kuadashboard
- Licencia: MIT

## 3. Naturaleza Open Source

KuaDashboard es un proyecto open source con codigo fuente auditable por terceros. Esto implica:

- Transparencia del codigo y trazabilidad de cambios.
- Posibilidad de revision independiente de seguridad y calidad.
- Uso de licenciamiento permisivo (MIT) para adopcion y evaluacion tecnica.
- Colaboracion comunitaria y mejora continua del software.

## 4. Seguridad, confianza y trazabilidad

Para reducir riesgos en distribucion y ejecucion del software, el proyecto incorpora controles de confianza:

- Firma de codigo para binarios de distribucion.
- Notarizacion en macOS para validacion de integridad y origen.
- Publicacion de artefactos versionados y verificables.
- Gestion de credenciales con mecanismos cifrados en la aplicacion.

## 5. Alcance funcional para evaluacion

KuaDashboard permite administracion centralizada de infraestructura y operaciones, incluyendo:

- Gestion de recursos Kubernetes (pods, deployments, services, ingress, storage y nodos).
- Integracion con servicios AWS y GCP.
- Logs en tiempo real, shell interactiva y terminal local integrada.
- Port forwarding persistente para servicios y pods.

## 6. Declaracion de uso y cumplimiento

El software se distribuye para uso tecnico y operativo en entornos de desarrollo, pruebas y produccion, sujeto a:

- Politicas internas del cliente/organizacion.
- Controles de seguridad de red, identidad y acceso aplicables.
- Validaciones propias del proceso de certificacion requerido por la entidad solicitante.

Este documento describe las caracteristicas tecnicas del producto para fines de soporte documental y no reemplaza certificados emitidos por autoridades regulatorias o entidades de certificacion acreditadas.

## 7. Evidencia recomendada para anexar a la certificacion

Se recomienda adjuntar, junto con este documento:

1. URL del repositorio oficial y licencia.
2. Version exacta evaluada (tag o release).
3. Checksums de artefactos de instalacion.
4. Evidencia de firma/notarizacion de binarios.
5. Registro de cambios (changelog) de la version evaluada.

## 8. Contacto tecnico

Para validaciones tecnicas adicionales, revisiones de arquitectura o evidencia complementaria, utilizar el repositorio oficial del proyecto y sus canales de soporte/mantenimiento.
