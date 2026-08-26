const RESOURCE_PRESENTATION = Object.freeze({
  lambda: { icon: 'square-function', tone: 'compute' },
  layer: { icon: 'layers-3', tone: 'compute' },
  function: { icon: 'square-function', tone: 'compute' },
  sqs: { icon: 'messages-square', tone: 'application' },
  queue: { icon: 'messages-square', tone: 'application' },
  sns: { icon: 'megaphone', tone: 'application' },
  stepfunctions: { icon: 'workflow', tone: 'application' },
  eventbridge: { icon: 'radio-tower', tone: 'application' },
  s3: { icon: 'archive', tone: 'storage' },
  storage: { icon: 'archive', tone: 'storage' },
  dynamodb: { icon: 'database', tone: 'database' },
  database: { icon: 'database', tone: 'database' },
  iam: { icon: 'shield-user', tone: 'security-simple' },
  'iam-policy': { icon: 'file-key', tone: 'security-simple' },
  policy: { icon: 'file-text', tone: 'security-simple' },
  api: { icon: 'braces', tone: 'network' },
  'api-route': { icon: 'route', tone: 'network' },
  'api-integration': { icon: 'plug', tone: 'network' },
  ecs: { icon: 'container', tone: 'compute' },
  logs: { icon: 'logs', tone: 'management' },
  secret: { icon: 'key-round', tone: 'security-simple' },
  external: { icon: 'external-link', tone: 'neutral' },
})

export function architectureResourcePresentation(resourceType) {
  return RESOURCE_PRESENTATION[resourceType] || { icon: 'box', tone: 'neutral' }
}