const RESOURCE_ICONS = Object.freeze({
  lambda: 'function-square',
  kubernetes: 'container',
  sqs: 'list-end',
  eventbridge: 'route',
  stepfunctions: 'workflow',
  ecs: 'container',
  s3: 'hard-drive',
  sns: 'radio',
  dynamodb: 'database',
  ec2: 'server',
  eks: 'boxes',
  rds: 'database',
  apigateway: 'route',
  cloudfront: 'globe',
  autoscaling: 'scaling',
  elasticache: 'zap',
  'gcp-cloud-run': 'cloud-cog',
  'gcp-function': 'function-square',
  'vercel-project': 'triangle',
})

const RESOURCE_LABELS = Object.freeze({
  lambda: 'AWS Lambda',
  kubernetes: 'Kubernetes',
  sqs: 'Amazon SQS',
  eventbridge: 'Amazon EventBridge',
  stepfunctions: 'AWS Step Functions',
  ecs: 'Amazon ECS',
  s3: 'Amazon S3',
  sns: 'Amazon SNS',
  dynamodb: 'Amazon DynamoDB',
  ec2: 'Amazon EC2',
  eks: 'Amazon EKS',
  rds: 'Amazon RDS',
  apigateway: 'Amazon API Gateway',
  cloudfront: 'Amazon CloudFront',
  autoscaling: 'AWS Auto Scaling',
  elasticache: 'Amazon ElastiCache',
  'gcp-cloud-run': 'Google Cloud Run',
  'gcp-function': 'Google Cloud Functions',
  'vercel-project': 'Vercel Project',
})

// apm_resources stores every Kubernetes object under the single generic type "kubernetes" (Deployment,
// Pod, Service, ...); the specific kind lives in resource.kind. Without this map every k8s resource
// (workload or not) looked identical in Observability's Resources table and Topology view.
const KUBERNETES_KIND_ICONS = Object.freeze({
  deployment: 'boxes', statefulset: 'database-zap', daemonset: 'rows-3', pod: 'container',
  service: 'network', ingress: 'route', configmap: 'file-cog', secret: 'key-round',
  persistentvolumeclaim: 'hard-drive', pvc: 'hard-drive',
})

function kubernetesKindLabel(resource) {
  const kind = String(resource?.kind || '').trim()
  return kind && kind.toLowerCase() !== 'kubernetes' ? `Kubernetes ${kind}` : 'Kubernetes'
}

export function apmResourceIcon(resource) {
  const type = typeof resource === 'string' ? resource : resource?.type
  if (type === 'kubernetes') {
    const kind = String((typeof resource === 'object' && resource?.kind) || '').toLowerCase()
    return KUBERNETES_KIND_ICONS[kind] || RESOURCE_ICONS.kubernetes
  }
  return RESOURCE_ICONS[type] || 'box'
}

export function apmResourceLabel(resource) {
  if (resource?.type === 'kubernetes') return kubernetesKindLabel(resource)
  return RESOURCE_LABELS[resource?.type] || resource?.kind || resource?.type || 'AWS resource'
}

export function apmResourceLocation(resource) {
  if (!resource) return ''
  if (resource.type === 'lambda') return resource.logGroup || resource.arn || ''
  if (resource.type === 'kubernetes') return [resource.kubeContext, resource.namespace].filter(Boolean).join(' / ')
  if (resource.type === 'eventbridge') return resource.service || 'default'
  if (resource.type === 'ecs') return resource.service || resource.arn || ''
  if (resource.type === 'gcp-cloud-run' || resource.type === 'gcp-function' || resource.type === 'vercel-project') return resource.service || resource.kind || ''
  return resource.arn || resource.service || resource.kind || ''
}