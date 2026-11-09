// Relate an entry only to a unique, explicit AWS DNS identity from the selected
// profile. Never guess from an Ingress name, annotation, IP address or prefix.
const dnsName = value => String(value || '').trim().toLowerCase().replace(/\.$/, '')
const isHostname = value => value.length <= 253 && value.includes('.') && /^[a-z0-9.-]+$/.test(value) && !/^\d+(\.\d+){3}$/.test(value)
const entryKey = entry => `${entry.kind}/${entry.namespace}/${entry.name}`
const V2_ARN = /^arn:(aws(?:-[a-z]+)*):elasticloadbalancing:([a-z0-9-]+):(\d{12}):loadbalancer\/(app|net|gwy)\/[A-Za-z0-9-]+\/[a-f0-9]+$/

export function linkAwsEntrypoints(entries, loadBalancers, profileId) {
  const matches = {}, ambiguous = []
  if (!profileId) return { matches, ambiguous }
  for (const entry of entries) {
    const addresses = new Set((entry.addresses || []).map(dnsName).filter(isHostname))
    const candidates = new Map()
    for (const lb of loadBalancers || []) {
      const arn = V2_ARN.exec(String(lb.arn || ''))
      if (!arn || !lb.dnsName || !addresses.has(dnsName(lb.dnsName))) continue
      candidates.set(lb.arn, {
        resourceType: 'loadbalancer', kind: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
        arn: lb.arn, name: lb.name, region: arn[2], accountId: arn[3], awsProfileId: profileId,
        scheme: lb.scheme || '', evidence: 'exact_dns_match',
      })
    }
    const key = entryKey(entry)
    if (candidates.size === 1) matches[key] = [...candidates.values()][0]
    else if (candidates.size > 1) ambiguous.push(key)
  }
  return { matches, ambiguous }
}
export { entryKey }
