---
title: "Dashboard de AWS para escritorio — EC2, EKS, ECS, Lambda y CloudWatch"
description: "KUA es un dashboard de AWS gratuito y open source para tu escritorio: EC2, ECS, EKS, Lambda, S3, DynamoDB, RDS, CloudFormation, CloudWatch Logs y costos de cada cuenta y región, con perfiles SSO."
schema: app
faq:
  - q: "¿KUA es una alternativa a la consola de AWS?"
    a: "Para el trabajo diario en los servicios de esta página, sí: KUA los muestra en una app de escritorio con la cuenta y la región siempre visibles, un Advisor y costos. Para servicios que no cubre, o configuración de cuenta y facturación, sigues usando la AWS Management Console."
  - q: "¿KUA funciona con AWS SSO (IAM Identity Center)?"
    a: "Sí. KUA lee los perfiles de ~/.aws, incluidos los creados con aws configure sso, tiene login SSO integrado y acepta credenciales temporales de STS."
  - q: "¿Usar KUA cuesta dinero en AWS?"
    a: "La mayoría de las lecturas son llamadas gratuitas a la API de AWS. Las que AWS cobra, como GetMetricData de CloudWatch, consultas de Logs Insights y Cost Explorer, dicen cuánto cuestan y tienen límites que controlas en Ayuda → Opciones."
---

# Un dashboard de AWS en tu escritorio

KUA es un **dashboard de AWS** gratuito y open source que lee tus cuentas con los perfiles que ya usas (incluidos SSO y credenciales temporales) y muestra los servicios con los que trabajas a diario en una app de escritorio, con la cuenta y la región siempre a la vista.

![Resumen del dashboard de AWS de KUA](/screenshots/dashboard-main.png)

## Los servicios de AWS que usas, en una app

- **Cómputo:** EC2 con inicio, detención y sesiones SSH y RDP persistentes, clústeres, servicios y tareas de ECS, clústeres EKS.
- **Serverless:** funciones Lambda (configuración e invocación, confirmada antes), API Gateway, EventBridge y Step Functions con diagrama visual.
- **Almacenamiento y datos:** explorador de S3, DynamoDB, RDS, ECR, volúmenes EBS, Glue, Athena y DocumentDB.
- **Red:** VPC, Load Balancers, CloudFront y Route 53.
- **Operación:** stacks de CloudFormation (solo lectura), CloudWatch Logs con caché local y Logs Insights, dashboards de CloudWatch, SQS, SNS y SES.

## Lo que lo hace más rápido que la consola

- **Primero el resumen:** lo que necesita atención en las últimas 24 horas, antes de cualquier tabla.
- **Cada pestaña dice su perfil, cuenta y región,** y un dato no leído nunca se muestra como cero.
- **Costos:** costos de AWS desde Cost Explorer por perfil, y cada lectura con costo (métricas de CloudWatch, Logs Insights) dice cuánto cuesta antes de ejecutarse.
- **Advisor para AWS:** IAM, S3, SQS, SNS, DynamoDB, CloudFront y más, desde un escaneo en caché.
- **Mínimo privilegio:** una guía de política IAM de solo lectura, y KUA trabaja con los permisos que le das.

## Tus credenciales quedan en tu computador

KUA usa tus perfiles de `~/.aws`, sesiones SSO o llaves guardadas cifradas en tu computador, y llama directo a las APIs de AWS. Su API local solo escucha en 127.0.0.1.

[Descargar KUA](/es/download) · [Primeros pasos](/es/guide/getting-started) · [Todas las funcionalidades](/es/features/)

## Preguntas frecuentes

<div class="home-faq">
  <details v-for="item in $frontmatter.faq" :key="item.q">
    <summary>{{ item.q }}</summary>
    <p>{{ item.a }}</p>
  </details>
</div>

## Sigue leyendo

- [AWS en detalle](/es/features/aws)
- [Dashboard multi-cloud](/es/multi-cloud-dashboard)
- [Dashboard de Kubernetes para EKS](/es/kubernetes-dashboard)
- [Credenciales y perfiles](/es/guide/credentials)

<small>Kubernetes es una marca registrada de The Linux Foundation. AWS, Google Cloud, Vercel, Lens y k9s son marcas de sus respectivos dueños. KUA es un proyecto open source independiente, sin afiliación ni respaldo de ellos.</small>
