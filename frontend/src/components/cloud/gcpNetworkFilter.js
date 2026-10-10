// Search over the firewall rules of a GCP network: name, description, CIDR, network
// tag, service account, protocol or port (a port inside a range, or a rule for all
// ports). The same idea as the AWS security group search (vpcSecurityGroups.js).

/** True when one of the rule's protocol entries covers the port. */
export function firewallCoversPort(rule, port) {
  return (rule.protocols || []).some(({ protocol, ports = [] }) => {
    if (protocol === 'all' || !ports.length) return true
    return ports.some(range => {
      const [from, to = from] = String(range).split('-').map(Number)
      return port >= from && port <= to
    })
  })
}

export function filterFirewallRules(rules = [], search = '') {
  const query = search.trim().toLowerCase()
  if (!query) return rules
  const port = /^\d{1,5}$/.test(query) ? Number(query) : null
  return rules.filter(rule => {
    if (port != null && firewallCoversPort(rule, port)) return true
    const texts = [
      rule.name, rule.description,
      ...(rule.sourceRanges || []), ...(rule.destinationRanges || []),
      ...(rule.sourceTags || []), ...(rule.targetTags || []),
      ...(rule.sourceServiceAccounts || []), ...(rule.targetServiceAccounts || []),
      ...(rule.protocols || []).map(entry => entry.protocol),
    ]
    return texts.some(text => text && String(text).toLowerCase().includes(query))
  })
}

/** "tcp:22,80-90 · udp" */
export function formatFirewallProtocols(protocols = []) {
  return protocols.map(({ protocol, ports = [] }) => (ports.length ? `${protocol}:${ports.join(',')}` : protocol)).join(' · ')
}
