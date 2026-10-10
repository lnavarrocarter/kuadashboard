// Security group rules of a VPC: who a rule allows (IPv4, IPv6, prefix lists and
// other groups) and a search over groups by name, id, description, CIDR, port or
// referenced group. A rule open to 0.0.0.0/0 is shown as such, never as "public":
// exposure also depends on routes, addressing and what the group is attached to.

/** Sources (inbound) or destinations (outbound) of a rule, labelled by kind. */
export function rulePeers(rule, groupNames = {}) {
  const peers = [
    ...(rule.IpRanges || []).map(range => ({ kind: 'ipv4', value: range.CidrIp, description: range.Description || '' })),
    ...(rule.Ipv6Ranges || []).map(range => ({ kind: 'ipv6', value: range.CidrIpv6, description: range.Description || '' })),
    ...(rule.PrefixListIds || []).map(list => ({ kind: 'prefixList', value: list.PrefixListId, description: list.Description || '' })),
    ...(rule.UserIdGroupPairs || []).map(pair => ({
      kind: 'group',
      value: pair.GroupId,
      name: groupNames[pair.GroupId] || pair.GroupName || '',
      description: pair.Description || '',
    })),
  ].filter(peer => peer.value)
  return peers
}

/** True when the rule covers the port (all traffic covers every port). */
export function ruleCoversPort(rule, port) {
  if (rule.IpProtocol === '-1' || rule.FromPort == null) return true
  if (rule.FromPort === -1) return true   // ICMP "all types"
  return port >= rule.FromPort && port <= rule.ToPort
}

function ruleMatches(rule, query, port, groupNames) {
  if (port != null && ruleCoversPort(rule, port)) return true
  return rulePeers(rule, groupNames).some(peer =>
    [peer.value, peer.name, peer.description].some(text => text && text.toLowerCase().includes(query)))
}

/** Groups matching the search: name, id, description, or any inbound/outbound rule. */
export function filterSecurityGroups(groups = [], search = '') {
  const query = search.trim().toLowerCase()
  if (!query) return groups
  const port = /^\d{1,5}$/.test(query) ? Number(query) : null
  const groupNames = Object.fromEntries(groups.map(group => [group.GroupId, group.GroupName]))
  return groups.filter(group =>
    [group.GroupName, group.GroupId, group.Description].some(text => text && text.toLowerCase().includes(query))
    || [...(group.IpPermissions || []), ...(group.IpPermissionsEgress || [])].some(rule => ruleMatches(rule, query, port, groupNames)))
}
