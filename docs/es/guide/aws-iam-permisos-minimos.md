# AWS IAM - permisos minimos por servicio

Este documento consolida los permisos IAM minimos para las integraciones AWS usadas por KuaDashboard.

## Notas importantes

- Varias acciones de tipo List/Describe no soportan resource-level y requieren `"Resource": "*"`.
- Donde se indica un patron ARN con `*`, se recomienda restringirlo a recursos concretos por entorno.
- Si usas claves KMS customer-managed (por ejemplo en Secrets Manager), agrega permisos KMS explicitos.

## Base comun (recomendada)

Acciones:

- `sts:GetCallerIdentity`
- `cloudwatch:GetMetricStatistics`
- `cloudwatch:GetMetricData`
- `logs:DescribeLogGroups`
- `logs:FilterLogEvents`

Recurso:

- `*`

---

## EC2 + VPC

ARN recomendados:

- `arn:aws:ec2:REGION:ACCOUNT:instance/*`
- `arn:aws:ec2:REGION:ACCOUNT:vpc/*`
- `arn:aws:ec2:REGION:ACCOUNT:subnet/*`
- `arn:aws:ec2:REGION:ACCOUNT:security-group/*`
- `arn:aws:ec2:REGION:ACCOUNT:route-table/*`
- `arn:aws:ec2:REGION:ACCOUNT:internet-gateway/*`
- `arn:aws:ec2:REGION:ACCOUNT:natgateway/*`

Lectura:

- `ec2:DescribeRegions`
- `ec2:DescribeInstances`
- `ec2:DescribeInstanceStatus`
- `ec2:DescribeVolumes`
- `ec2:DescribeSecurityGroups`
- `ec2:DescribeVpcs`
- `ec2:DescribeSubnets`
- `ec2:DescribeRouteTables`
- `ec2:DescribeInternetGateways`
- `ec2:DescribeNatGateways`
- `ec2:DescribeTags`

Mutacion opcional:

- `ec2:StartInstances`
- `ec2:StopInstances`
- `ec2:CreateTags`
- `ec2:DeleteTags`

---

## ECS

ARN recomendados:

- `arn:aws:ecs:REGION:ACCOUNT:cluster/*`
- `arn:aws:ecs:REGION:ACCOUNT:service/*/*`
- `arn:aws:ecs:REGION:ACCOUNT:task-definition/*`

Lectura:

- `ecs:ListClusters`
- `ecs:ListServices`
- `ecs:DescribeServices`
- `ecs:DescribeTaskDefinition`
- `ecs:ListTagsForResource`

Mutacion opcional:

- `ecs:UpdateService`
- `ecs:RegisterTaskDefinition` (si habilitas logging de ECS)
- `ecs:TagResource`
- `ecs:UntagResource`

---

## EKS

ARN recomendados:

- `arn:aws:eks:REGION:ACCOUNT:cluster/*`

Lectura:

- `eks:ListClusters`
- `eks:DescribeCluster`
- `eks:ListNodegroups`
- `eks:ListTagsForResource`

Mutacion opcional:

- `eks:TagResource`
- `eks:UntagResource`

Nota:

- Para operar dentro del cluster con kubectl tambien necesitas permisos/RBAC de Kubernetes.

---

## Lambda

ARN recomendados:

- `arn:aws:lambda:REGION:ACCOUNT:function:*`

Lectura:

- `lambda:ListFunctions`
- `lambda:GetFunction`
- `lambda:GetFunctionConfiguration`
- `lambda:ListAliases`
- `lambda:ListVersionsByFunction`
- `lambda:GetPolicy`
- `lambda:GetFunctionConcurrency`
- `lambda:ListTags`

Mutacion opcional:

- `lambda:InvokeFunction`
- `lambda:UpdateFunctionConfiguration`
- `lambda:TagResource`
- `lambda:UntagResource`

---

## API Gateway (REST + HTTP/WebSocket)

Recurso recomendado:

- `*` (management API suele requerir granularidad amplia)

Lectura:

- `apigateway:GET`

---

## S3

ARN recomendados:

- `arn:aws:s3:::BUCKET`
- `arn:aws:s3:::BUCKET/*`

Lectura:

- `s3:ListAllMyBuckets`
- `s3:GetBucketLocation`
- `s3:HeadBucket`
- `s3:ListBucket`
- `s3:GetObject`
- `s3:HeadObject`
- `s3:GetBucketTagging`
- `s3:GetBucketVersioning`
- `s3:GetBucketEncryption`
- `s3:GetBucketAcl`
- `s3:GetBucketPolicyStatus`

Mutacion opcional:

- `s3:CreateBucket`
- `s3:PutPublicAccessBlock`
- `s3:PutBucketTagging`
- `s3:DeleteBucketTagging`

---

## ECR

ARN recomendados:

- `arn:aws:ecr:REGION:ACCOUNT:repository/*`

Lectura:

- `ecr:DescribeRepositories`
- `ecr:ListImages`
- `ecr:DescribeImages`
- `ecr:GetLifecyclePolicy`
- `ecr:ListTagsForResource`

Mutacion opcional:

- `ecr:TagResource`
- `ecr:UntagResource`

---

## EventBridge

ARN recomendados:

- `arn:aws:events:REGION:ACCOUNT:event-bus/*`
- `arn:aws:events:REGION:ACCOUNT:rule/*/*`

Lectura:

- `events:ListEventBuses`
- `events:ListRules`
- `events:DescribeRule`
- `events:ListTargetsByRule`
- `events:ListTagsForResource`

Mutacion opcional:

- `events:TagResource`
- `events:UntagResource`

---

## Step Functions

ARN recomendados:

- `arn:aws:states:REGION:ACCOUNT:stateMachine:*`

Lectura:

- `states:ListStateMachines`
- `states:DescribeStateMachine`
- `states:ListExecutions`
- `states:ListTagsForResource`

Mutacion opcional:

- `states:TagResource`
- `states:UntagResource`

---

## Glue

ARN recomendados:

- `arn:aws:glue:REGION:ACCOUNT:job/*`
- `arn:aws:glue:REGION:ACCOUNT:database/*`
- `arn:aws:glue:REGION:ACCOUNT:table/*/*`
- `arn:aws:glue:REGION:ACCOUNT:catalog`
- `arn:aws:glue:REGION:ACCOUNT:connection/*`

Lectura:

- `glue:GetJobs`
- `glue:GetJob`
- `glue:GetJobRuns`
- `glue:GetDatabases`
- `glue:GetTables`
- `glue:GetConnections`

Mutacion opcional:

- `glue:StartJobRun`

---

## DocumentDB

ARN recomendados:

- `arn:aws:rds:REGION:ACCOUNT:cluster:*`
- `arn:aws:rds:REGION:ACCOUNT:db:*`

Lectura:

- `docdb:DescribeDBClusters`
- `docdb:DescribeDBInstances`

Mutacion opcional:

- `docdb:ModifyDBCluster`
- `docdb:CreateDBCluster`
- `docdb:CreateDBInstance`

---

## RDS

ARN recomendados:

- `arn:aws:rds:REGION:ACCOUNT:db:*`
- `arn:aws:rds:REGION:ACCOUNT:cluster:*` (si usas Aurora)

Lectura:

- `rds:DescribeDBInstances`
- `rds:DescribeDBClusters` (si usas Aurora)
- `rds:ListTagsForResource`

Mutacion opcional:

- `rds:StartDBInstance`
- `rds:StopDBInstance`
- `rds:RebootDBInstance`
- `rds:ModifyDBInstance`
- `rds:AddTagsToResource`
- `rds:RemoveTagsFromResource`

---

## DynamoDB

ARN recomendados:

- `arn:aws:dynamodb:REGION:ACCOUNT:table/*`

Lectura:

- `dynamodb:ListTables`
- `dynamodb:DescribeTable`
- `dynamodb:Scan`
- `dynamodb:Query`

Mutacion opcional:

- `dynamodb:CreateTable`

---

## Athena

ARN recomendados:

- `arn:aws:athena:REGION:ACCOUNT:workgroup/*`
- `*` (catalogos y metadatos suelen requerir wildcard)

Lectura:

- `athena:ListWorkGroups`
- `athena:GetWorkGroup`
- `athena:ListDataCatalogs`
- `athena:GetDataCatalog`
- `athena:ListDatabases`
- `athena:ListTableMetadata`
- `athena:ListQueryExecutions`
- `athena:GetQueryExecution`
- `athena:GetQueryResults`

Mutacion opcional:

- `athena:StartQueryExecution`

Extra requerido frecuente:

- Permisos S3 sobre bucket de resultados de Athena (`s3:PutObject`, `s3:GetObject`, `s3:ListBucket`).

---

## CloudFront

ARN recomendados:

- `arn:aws:cloudfront::ACCOUNT:distribution/*`

Lectura:

- `cloudfront:ListDistributions`
- `cloudfront:GetDistribution`

Mutacion opcional:

- `cloudfront:CreateInvalidation`
- `cloudfront:CreateDistribution`

Nota:

- CloudFront es global y normalmente se gestiona en us-east-1 para API de control.

---

## Route 53

ARN recomendados:

- `arn:aws:route53:::hostedzone/*`

Lectura:

- `route53:ListHostedZones`
- `route53:ListResourceRecordSets`

---

## Cognito (User Pools)

ARN recomendados:

- `arn:aws:cognito-idp:REGION:ACCOUNT:userpool/*`

Lectura:

- `cognito-idp:ListUserPools`
- `cognito-idp:DescribeUserPool`
- `cognito-idp:ListUsers`
- `cognito-idp:AdminGetUser`
- `cognito-idp:ListUserPoolClients`
- `cognito-idp:DescribeUserPoolClient`
- `cognito-idp:ListIdentityProviders`
- `cognito-idp:DescribeIdentityProvider`
- `cognito-idp:ListGroups`

Mutacion opcional:

- `cognito-idp:AdminCreateUser`
- `cognito-idp:AdminResetUserPassword`
- `cognito-idp:AdminSetUserPassword`
- `cognito-idp:AdminEnableUser`
- `cognito-idp:AdminDisableUser`
- `cognito-idp:AdminDeleteUser`

---

## Secrets Manager

ARN recomendados:

- `arn:aws:secretsmanager:REGION:ACCOUNT:secret:*`

Lectura:

- `secretsmanager:ListSecrets`
- `secretsmanager:DescribeSecret`
- `secretsmanager:GetSecretValue`

Extra opcional/requerido segun clave:

- `kms:Decrypt` sobre la CMK del secreto si no usa clave administrada por AWS.

---

## Data Pipeline

ARN recomendados:

- `arn:aws:datapipeline:REGION:ACCOUNT:pipeline/*`

Lectura:

- `datapipeline:ListPipelines`
- `datapipeline:DescribePipelines`

Mutacion opcional:

- `datapipeline:ActivatePipeline`
- `datapipeline:DeactivatePipeline`

---

## Bedrock

Recurso recomendado:

- `*`

Lectura:

- `bedrock:ListFoundationModels`

---

## Lex V2 (Models + Runtime)

ARN recomendados:

- `arn:aws:lex:REGION:ACCOUNT:bot/*`
- `arn:aws:lex:REGION:ACCOUNT:bot-alias/*`
- `arn:aws:lex:REGION:ACCOUNT:bot/*/botversion/*/botlocale/*`

Lectura:

- `lex:ListBots`
- `lex:ListBotLocales`
- `lex:ListIntents`
- `lex:ListSlots`
- `lex:ListTestSets`
- `lex:ListBotAliases`
- `lex:DescribeBotAlias`
- `lex:DescribeBot`
- `lex:ListSlotTypes`
- `lex:DescribeSlotType`
- `lex:DescribeBotLocale`

Mutacion opcional:

- `lex:CreateBotAlias`
- `lex:BuildBotLocale`

Runtime opcional:

- `lex:RecognizeText`

---

## CloudFormation

Recurso recomendado:

- `*`

Lectura:

- `cloudformation:ListStacks`

---

## Recomendacion de implementacion

1. Crea una politica base de solo lectura con todos los bloques de lectura.
2. Crea una segunda politica operativa con solo las acciones de mutacion necesarias.
3. Asigna la politica operativa solo a roles de operacion y en cuentas/entornos acotados.
4. Usa condiciones IAM (`aws:RequestedRegion`, `aws:ResourceTag`, `aws:PrincipalTag`) cuando aplique.
