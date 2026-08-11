const RESOURCE_ICONS = Object.freeze({
  lambda: 'function-square',
  kubernetes: 'container',
  sqs: 'list-end',
  eventbridge: 'route',
  stepfunctions: 'workflow',
  ecs: 'container',
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
  'gcp-cloud-run': 'Google Cloud Run',
  'gcp-function': 'Google Cloud Functions',
  'vercel-project': 'Vercel Project',
})

export function apmResourceIcon(type) {
  return RESOURCE_ICONS[type] || 'box'
}

export function apmResourceLabel(resource) {
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