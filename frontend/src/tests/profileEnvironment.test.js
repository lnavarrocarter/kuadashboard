import { describe, expect, it } from 'vitest'
import { cloudProfileEnvironment, cloudProfileText } from '../lib/profileEnvironment'

const lists = {
  awsProfiles: [{ id: 'p-1', name: 'prod' }, { id: 'p-2', name: 'billing' }],
  gcpProfiles: [{ id: 'g-1', name: 'analytics', projectId: 'acme-staging' }],
  gcpLocalConfigs: [{ name: 'work', project: 'acme-prd' }],
  vercelProfiles: [{ id: 'v-1', name: 'web-dev' }],
}

describe('environment of the cloud profile in the header (H3)', () => {
  it('reads stored and local profiles like a kube context', () => {
    expect(cloudProfileEnvironment('aws', 'p-1', lists)).toBe('production')
    expect(cloudProfileEnvironment('aws', 'local:dev', lists)).toBe('development')
    expect(cloudProfileEnvironment('gcp', 'g-1', lists)).toBe('staging')
    expect(cloudProfileEnvironment('gcp', 'local:work', lists)).toBe('production')   // from its project
    expect(cloudProfileEnvironment('vercel', 'v-1', lists)).toBe('development')
  })

  it('leaves the environment unidentified when the name says nothing', () => {
    expect(cloudProfileEnvironment('aws', 'p-2', lists)).toBeNull()
    expect(cloudProfileEnvironment('aws', 'missing', lists)).toBeNull()
    expect(cloudProfileEnvironment('aws', '', lists)).toBeNull()
    expect(cloudProfileText('gcp', 'local:work', lists)).toBe('work acme-prd')
  })
})
