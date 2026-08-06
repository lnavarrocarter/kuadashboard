const RESOURCE_ICONS = Object.freeze({
  lambda: 'function-square',
  kubernetes: 'container',
  sqs: 'list-end',
  eventbridge: 'route',
  stepfunctions: 'workflow',
  ecs: 'container',
})

const RESOURCE_LABELS = Object.freeze({
  lambda: 'AWS Lambda',
  kubernetes: 'Kubernetes',
  sqs: 'Amazon SQS',
  eventbridge: 'Amazon EventBridge',
  stepfunctions: 'AWS Step Functions',
  ecs: 'Amazon ECS',
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
  return resource.arn || resource.service || resource.kind || ''
}