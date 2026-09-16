// This contract is also imported by the Node backend. Never add credential fields.
export const capabilityRegistry = Object.freeze([
  { id: 'local-shell', provider: 'local', transport: 'shell', path: '/ws/shell', status: 'available', required: [] },
  { id: 'kubernetes-logs', provider: 'kubernetes', transport: 'logs', path: '/ws/logs', status: 'available', required: ['target.namespace', 'target.name'] },
  { id: 'kubernetes-exec', provider: 'kubernetes', transport: 'exec', path: '/ws/exec', status: 'available', required: ['target.namespace', 'target.name'] },
  { id: 'ec2-ssh', provider: 'aws', transport: 'ssh', path: '/ws/ec2-shell', status: 'available', required: ['profileId', 'target.host', 'target.user'] },
  { id: 'ec2-rdp', provider: 'aws', transport: 'rdp', path: '/ws/ec2-rdp', status: 'available', required: ['profileId', 'target.host', 'target.user'] },
  { id: 'aws-ssm', provider: 'aws', transport: 'ssm', status: 'planned', required: ['profileId', 'region', 'target.instanceId'] },
  { id: 'gcp-shell', provider: 'gcp', transport: 'cloud-shell', status: 'planned', required: ['profileId', 'project'] },
  { id: 'vercel-logs', provider: 'vercel', transport: 'deployment-logs', status: 'planned', required: ['profileId', 'target.name'] },
].map(item => Object.freeze({ ...item, required: Object.freeze(item.required) })))

const text = value => typeof value === 'string' && value.length <= 512 && !/[\r\n\x00]/.test(value) ? value : null
export function sessionDescriptor(input = {}) {
  if (!input || typeof input !== 'object') input = {}
  const target = {}
  for (const key of ['namespace', 'name', 'resourceType', 'container', 'selectedPod', 'host', 'user', 'instanceId', 'domain']) {
    const value = text(input.target?.[key])
    if (value) target[key] = value
  }
  for (const key of ['port', 'width', 'height']) {
    const value = input.target?.[key]
    if (Number.isInteger(value) && value > 0 && value <= 65535) target[key] = value
  }
  const descriptor = { target }
  for (const key of ['provider', 'environment', 'applicationId', 'profileId', 'region', 'project', 'kubeContext', 'transport']) {
    descriptor[key] = text(input[key])
  }
  descriptor.environment ||= 'default'
  descriptor.capabilities = capabilityRegistry.filter(c => c.provider === descriptor.provider).map(c => c.id)
  descriptor.connectionState = 'idle'
  return descriptor
}

export function validateSession(input) {
  const session = sessionDescriptor(input)
  const capability = capabilityRegistry.find(c => c.provider === session.provider && c.transport === session.transport)
  if (!capability || capability.status !== 'available') throw new Error('Capability unavailable')
  for (const field of capability.required) {
    if (!field.split('.').reduce((value, key) => value?.[key], session)) throw new Error(`Missing context: ${field}`)
  }
  if (session.provider === 'kubernetes') {
    const resourceType = session.target.resourceType || 'pods'
    if (!(session.transport === 'exec' ? ['pods'] : ['pods', 'deployments', 'statefulsets', 'daemonsets']).includes(resourceType)) {
      throw new Error('Unsupported Kubernetes target')
    }
  }
  return { session, capability }
}
