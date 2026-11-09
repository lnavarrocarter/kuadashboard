import { describe, it, expect } from 'vitest'
import { linkAwsEntrypoints, entryKey } from '../lib/kubeEntrypointLinks'
import { awsViewTarget } from '../lib/awsResourceLinks'
const entry = { kind: 'Ingress', namespace: 'shop', name: 'web', addresses: ['MY-ALB.us-east-1.elb.amazonaws.com.'] }
const lb = { arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/shop/abcdef', name: 'shop', dnsName: 'my-alb.us-east-1.elb.amazonaws.com', scheme: 'internal' }
describe('Kubernetes to AWS entry point links', () => {
  it('requires a selected profile and an exact normalized DNS match, keeping ARN account and region', () => {
    const result = linkAwsEntrypoints([entry], [lb], 'profile-one')
    const match = result.matches[entryKey(entry)]
    expect(match).toMatchObject({ arn: lb.arn, awsProfileId: 'profile-one', accountId: '123456789012', region: 'us-east-1', scheme: 'internal', evidence: 'exact_dns_match' })
    expect(awsViewTarget(match)).toMatchObject({ tab: 'elb', search: 'shop' })
    expect(linkAwsEntrypoints([entry], [lb], '').matches).toEqual({})
    expect(linkAwsEntrypoints([{ ...entry, addresses: ['other-' + lb.dnsName] }], [lb], 'profile-one').matches).toEqual({})
    expect(linkAwsEntrypoints([entry], [{ ...lb, arn: '' }], 'profile-one').matches).toEqual({})
    expect(linkAwsEntrypoints([{ ...entry, addresses: ['10.0.0.1'] }], [{ ...lb, dnsName: '10.0.0.1' }], 'profile-one').matches).toEqual({})
  })
  it('does not choose between multiple identities and deduplicates repeated identical identities', () => {
    const other = { ...lb, arn: lb.arn.replace('123456789012', '999999999999') }
    expect(linkAwsEntrypoints([entry], [lb, other], 'profile-one')).toEqual({ matches: {}, ambiguous: [entryKey(entry)] })
    expect(Object.keys(linkAwsEntrypoints([entry], [lb, lb], 'profile-one').matches)).toHaveLength(1)
  })
  it('keeps entries with identical names in different namespaces separate', () => {
    const second = { ...entry, namespace: 'other', addresses: ['different.example'] }
    const result = linkAwsEntrypoints([entry, second], [lb], 'profile-one')
    expect(Object.keys(result.matches)).toEqual([entryKey(entry)])
  })
})
