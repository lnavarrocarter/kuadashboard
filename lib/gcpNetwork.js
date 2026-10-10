'use strict';
/**
 * lib/gcpNetwork.js
 * Firewall rules and routes of a GCP VPC network, mapped for the VPC detail.
 * Pure: no I/O. A rule open to 0.0.0.0/0 is reported as it is, never as
 * "public": exposure also depends on targets, external addresses and routes.
 */

const last = value => (value ? String(value).split('/').pop() : '');

/** Protocols and ports of an allowed/denied list: [{ protocol, ports }]. */
function ruleProtocols(entries = []) {
  return entries.map(entry => ({ protocol: entry.IPProtocol || 'all', ports: entry.ports || [] }));
}

function mapFirewall(rule) {
  const allows = !!rule.allowed?.length;
  return {
    name:        rule.name,
    description: rule.description || '',
    direction:   rule.direction || 'INGRESS',
    priority:    rule.priority ?? 1000,
    action:      allows ? 'allow' : 'deny',
    protocols:   ruleProtocols(allows ? rule.allowed : rule.denied),
    sourceRanges:      rule.sourceRanges || [],
    destinationRanges: rule.destinationRanges || [],
    sourceTags:        rule.sourceTags || [],
    targetTags:        rule.targetTags || [],
    sourceServiceAccounts: rule.sourceServiceAccounts || [],
    targetServiceAccounts: rule.targetServiceAccounts || [],
    // Without target tags or service accounts the rule applies to every instance of the network.
    allInstances: !rule.targetTags?.length && !rule.targetServiceAccounts?.length,
    disabled: !!rule.disabled,
    logging:  !!rule.logConfig?.enable,
  };
}

/** Where a route sends traffic: the kind of next hop and its name or address. */
function nextHopOf(route) {
  if (route.nextHopGateway)  return { kind: 'gateway',  value: last(route.nextHopGateway) };
  if (route.nextHopInstance) return { kind: 'instance', value: last(route.nextHopInstance) };
  if (route.nextHopIp)       return { kind: 'ip',       value: route.nextHopIp };
  if (route.nextHopVpnTunnel) return { kind: 'vpnTunnel', value: last(route.nextHopVpnTunnel) };
  if (route.nextHopIlb)      return { kind: 'ilb',      value: route.nextHopIlb.includes('/') ? last(route.nextHopIlb) : route.nextHopIlb };
  if (route.nextHopPeering)  return { kind: 'peering',  value: route.nextHopPeering };
  if (route.nextHopNetwork)  return { kind: 'network',  value: last(route.nextHopNetwork) };
  return { kind: 'unknown', value: '' };
}

function mapRoute(route) {
  return {
    name:        route.name,
    description: route.description || '',
    destRange:   route.destRange || '',
    priority:    route.priority ?? 1000,
    nextHop:     nextHopOf(route),
    tags:        route.tags || [],
    // Created by GCP for subnets and peerings, not by the user.
    system:      route.routeType ? route.routeType !== 'STATIC' : !!route.nextHopNetwork || !!route.nextHopPeering,
  };
}

/** Lowest priority number first (it wins), then by name. */
const byPriority = (a, b) => a.priority - b.priority || a.name.localeCompare(b.name);

module.exports = { mapFirewall, mapRoute, byPriority };
