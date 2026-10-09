/**
 * lib/mcp/kuaMcp.mjs
 * MCP (Model Context Protocol) server core for KUA. Lets coding agents that
 * speak MCP (Claude Code, Codex CLI, Cursor…) read what KUA already knows —
 * Advisor findings and log intelligence — as the same Markdown briefs the UI
 * copies (shared/agentBrief.mjs), or as JSON.
 *
 * Every tool goes through the KUA API running on this machine (KUA must be
 * open); nothing here talks to a cloud provider directly. All tools read,
 * except apply_application_change, which runs a KUApps change the agent
 * previewed and the user approved, only while the user allows agent writes
 * in KUA (#155). It never creates, changes or deletes cloud resources.
 * The KUA routes it uses read data KUA already has or free control-plane APIs,
 * so no tool triggers a billed call. Credentials never leave KUA: profiles are
 * listed by id, name and provider only, and log samples arrive sanitized.
 *
 * Transport-agnostic: handle() takes one parsed JSON-RPC message and returns
 * the response (or null for notifications). mcp/server.mjs wires it to stdio.
 */

import { advisorBrief, logsBrief } from '../../frontend/src/shared/agentBrief.mjs'
import en from '../../frontend/src/locales/en.js'
import es from '../../frontend/src/locales/es.js'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const LOCALES = { en, es }

const INSTRUCTIONS = [
  'KUA (Know Unified Administration) is a local dashboard for Kubernetes, AWS, GCP and Vercel.',
  'Use these tools to read its deterministic findings before fixing infrastructure or code:',
  'list_profiles first to pick an AWS, GCP or Vercel profile, then aws_advisor, gcp_advisor, vercel_advisor or kubernetes_advisor;',
  'list_log_groups and log_intelligence for the errors seen in cached CloudWatch logs, list_kube_log_workloads and kube_log_intelligence for cached Kubernetes workloads, search_logs to find errors by meaning;',
  'list_applications and product_advisor for KUApps applications; get_application, list_application_resources and get_architecture_graph read one KUA Application (its scopes, resources with their signal state, and architecture views) through the same service as the KUApps UI.',
  'To change a KUA Application (create it, edit its details, attach or detach resources, link or unlink a view), call preview_application_change, show the preview to the user, and only after they approve call apply_application_change with its planId and confirm true; get_application_change reads the outcome if a response is lost. Never apply without the user\'s approval and never retry an apply with a new preview to get around an error.',
  'Briefs are snapshots: verify the current state before changing anything, and ask before destructive or billed operations.',
].join(' ')

/** t() over the bundled locales, same rules as the frontend (English fallback, {param} interpolation). */
export function translator(lang = 'en') {
  const locale = LOCALES[lang] || LOCALES.en
  return (key, params) => {
    const text = locale[key] ?? LOCALES.en[key] ?? key
    if (!params || typeof text !== 'string') return text
    return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`))
  }
}

const profileProp = { type: 'string', description: 'KUA profile id or name (see list_profiles). Optional when there is a single profile of that provider.' }
const formatProp = { type: 'string', enum: ['markdown', 'json'], description: 'markdown (default): a brief ready to act on. json: the raw KUA data.' }
const langProp = { type: 'string', enum: ['en', 'es'], description: 'Language of the brief (default en).' }
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const applicationProp = { type: 'string', description: 'KUA Application id or name (see list_applications). A name shared by several applications needs the id.' }
const SIGNAL_STATES = ['current', 'partial', 'stale', 'no_data', 'disabled', 'error', 'no_connection', 'unsupported']
const CHANGE_OPERATIONS = ['application.create', 'application.update', 'resources.attach', 'resources.detach', 'view.link', 'view.unlink']
// Names the client in KUA's audit log; KUA never grants anything because of it.
const ACTOR = { 'X-KUA-Actor': 'mcp', 'Content-Type': 'application/json' }

export const TOOLS = [
  {
    name: 'list_profiles',
    title: 'List KUA profiles',
    description: 'Lists the cloud profiles configured in KUA (id, name, provider). Credentials are never returned.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', enum: ['aws', 'gcp', 'vercel'], description: 'Only profiles of this provider.' } } },
  },
  {
    name: 'aws_advisor',
    title: 'AWS Advisor findings',
    description: 'Good-practice findings for an AWS profile (security, infrastructure, architecture, development): root MFA, old keys, open ports, public or unencrypted RDS, deprecated Lambda runtimes, orphan volumes… with affected resources and docs. Uses free control-plane APIs, cached 15 minutes.',
    inputSchema: { type: 'object', properties: { profile: profileProp, refresh: { type: 'boolean', description: 'Scan again instead of using the 15-minute cache (free control-plane calls).' }, format: formatProp, lang: langProp } },
  },
  {
    name: 'gcp_advisor',
    title: 'GCP Advisor findings',
    description: 'Good-practice findings for a GCP profile: default service accounts, public IPs, Cloud SQL backups and HA, bucket access, GKE hardening, deprecated runtimes… Reuses the last GCP overview KUA stored.',
    inputSchema: { type: 'object', properties: { profile: profileProp, format: formatProp, lang: langProp } },
  },
  {
    name: 'vercel_advisor',
    title: 'Vercel Advisor findings',
    description: 'Good-practice findings for a Vercel profile (account or team): secrets in plain env vars or shared with previews, unprotected previews, fork builds with secrets, failed production deploys, unverified domains, end-of-life Node.js… Reads env var names and types, never their values. Free Vercel API reads, cached 15 minutes.',
    inputSchema: { type: 'object', properties: { profile: profileProp, refresh: { type: 'boolean', description: 'Scan again instead of using the 15-minute cache (free Vercel API reads).' }, format: formatProp, lang: langProp } },
  },
  {
    name: 'kubernetes_advisor',
    title: 'Kubernetes Advisor findings',
    description: 'Good-practice findings for the current Kubernetes context of KUA: privileged or root containers, plain-text credentials in env vars, missing requests/limits/probes, single replicas, floating image tags, namespaces without NetworkPolicy…',
    inputSchema: { type: 'object', properties: { namespace: { type: 'string', description: 'Namespace to check (default: all).' }, format: formatProp, lang: langProp } },
  },
  {
    name: 'list_log_groups',
    title: 'List cached log groups',
    description: 'CloudWatch log groups cached by KUA for an AWS profile. Only cached groups have log intelligence.',
    inputSchema: { type: 'object', properties: { profile: profileProp } },
  },
  {
    name: 'log_intelligence',
    title: 'Log intelligence of a log group',
    description: 'What the logs of a cached CloudWatch log group show: error rates, recurring error signatures (sanitized), sensitive data reaching the logs, resources mentioned, and recommendations with evidence, Logs Insights queries and code snippets. Computed locally, no AWS call.',
    inputSchema: { type: 'object', properties: { profile: profileProp, group: { type: 'string', description: 'Log group name, e.g. /aws/lambda/orders.' }, format: formatProp, lang: langProp }, required: ['group'] },
  },
  {
    name: 'search_logs',
    title: 'Search errors by meaning',
    description: 'Finds recurring errors of the cached CloudWatch log groups (or Kubernetes workloads with provider "kubernetes") by meaning, in any language ("timeouts against the database", "permisos denegados"), with a local embedding model. Returns log group, sanitized signature, occurrences and similarity. Requires Local ML enabled in KUA (Intelligence → Local ML); runs on this machine, no cloud call.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', enum: ['aws', 'kubernetes'], description: 'aws (default): CloudWatch log groups of an AWS profile. kubernetes: cached workloads of the current Kubernetes context.' }, profile: profileProp, query: { type: 'string', description: 'What to look for, in plain words.' }, group: { type: 'string', description: 'Only this log group or workload (default: all cached).' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results (default 10).' } }, required: ['query'] },
  },
  {
    name: 'list_kube_log_workloads',
    title: 'List cached Kubernetes workloads',
    description: 'Kubernetes workloads whose pod logs KUA caches for the current context ("<namespace>/<kind>/<name>"), with events, size and last sync. Only cached workloads have log intelligence.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kube_log_intelligence',
    title: 'Log intelligence of a Kubernetes workload',
    description: 'What the pod logs of a cached Kubernetes workload show: error rates, anomalies, recurring error signatures (sanitized), similar errors, sensitive data reaching the logs, and recommendations with evidence and queries. Computed locally from the KUA cache.',
    inputSchema: { type: 'object', properties: { group: { type: 'string', description: 'Workload as <namespace>/<deployments|statefulsets|daemonsets|pods>/<name> (see list_kube_log_workloads).' }, format: formatProp, lang: langProp }, required: ['group'] },
  },
  {
    name: 'list_applications',
    title: 'List KUApps applications',
    description: 'Applications registered in KUApps (id, name, provider, environment, region).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'product_advisor',
    title: 'Product Advisor findings',
    description: 'Product findings for a KUApps application: breached or default objectives, missing owner or environment, no pre-production stage, missing architecture or stale telemetry. No cloud calls.',
    inputSchema: { type: 'object', properties: { application: { type: 'string', description: 'Application id or name (see list_applications).' }, format: formatProp, lang: langProp }, required: ['application'] },
  },
  {
    name: 'get_application',
    title: 'KUA Application context',
    description: 'One KUA Application as KUApps sees it: identity, revision, portable scopes (provider, account/project/context, location) with whether this computer has a verified profile for each, architecture views, counts of resources by signal state and of relationships by status, and warnings. Scopes come from the application, never from the AWS profile selected in KUA. Local data only.',
    inputSchema: { type: 'object', properties: { application: applicationProp }, required: ['application'] },
  },
  {
    name: 'list_application_resources',
    title: 'Resources of a KUA Application',
    description: 'The canonical resources of a KUA Application: portable identity, provider scope, where KUA learned about each (sources), its signal state (current, stale, partial, no_data, disabled, error, no_connection, unsupported) with the time of the latest data, and its relationships. A resource without data is never reported as healthy. Local data only.',
    inputSchema: { type: 'object', properties: { application: applicationProp, state: { type: 'string', enum: SIGNAL_STATES, description: 'Only resources in this signal state.' }, provider: { type: 'string', description: 'Only resources of this provider (aws, gcp, kubernetes, vercel…).' }, limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum resources (default 100).' } }, required: ['application'] },
  },
  {
    name: 'get_architecture_graph',
    title: 'Architecture view of a KUA Application',
    description: 'One architecture view of a KUA Application at its current revision: nodes (with their registry resource and whether they are hidden in this view) and relationships with their status, confidence, the human decision and the kinds of evidence behind them. It is the stored view, not a live read of the cloud; evidence is historical. Only views that belong to the application are served.',
    inputSchema: { type: 'object', properties: { application: applicationProp, view: { type: 'string', description: 'View (architecture project) id or name; default: the first view of the application (see get_application).' }, limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum nodes (default 300); relationships are limited to those between returned nodes.' } }, required: ['application'] },
  },
  {
    name: 'preview_application_change',
    title: 'Preview a KUApps change',
    description: 'Says what a change to a KUA Application would do, without changing it, and returns a planId valid for 15 minutes. Operations: application.create {name, environment?, team?, scopes?}; application.update {name?, environment?, team?}; resources.attach {resources: [{provider, type, key, name, arn?, scopeId?, location?, kubeContext?, namespace?, kind?}]} (each resource needs its native identifier and scope: an ARN, or scopeId and location; a kubeContext for Kubernetes; a name alone is refused); resources.detach {resourceIds} (registry ids from list_application_resources; the resource leaves the application, nothing is deleted in the cloud); view.link / view.unlink {projectId} (the view itself is kept). Show the preview to the user before applying.',
    inputSchema: { type: 'object', properties: { application: { type: 'string', description: 'KUA Application id or name; not used by application.create.' }, operation: { type: 'string', enum: CHANGE_OPERATIONS }, input: { type: 'object', description: 'The fields of the operation (see the description).' } }, required: ['operation', 'input'] },
    annotations: { title: 'Preview a KUApps change', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'apply_application_change',
    title: 'Apply a previewed KUApps change',
    description: 'Applies a change previewed with preview_application_change. Call it only after the user approved that preview, with confirm true. KUA refuses it when the user has not allowed agents to change KUApps, when the application changed since the preview (it returns the current revision; preview again) or when the plan expired. Applying the same planId again returns the recorded outcome and writes nothing: if a response is lost, read it with get_application_change instead of previewing again. Never creates, changes or deletes cloud resources.',
    inputSchema: { type: 'object', properties: { planId: { type: 'string' }, confirm: { type: 'boolean', description: 'true only after the user approved the preview.' } }, required: ['planId', 'confirm'] },
    annotations: { title: 'Apply a previewed KUApps change', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_application_change',
    title: 'Outcome of a KUApps change',
    description: 'The state of a change plan: planned, expired, applied, partial, failed or conflict, with its preview, the outcome of each item and the application revision before and after. Use it when an apply response was lost.',
    inputSchema: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'] },
  },
].map(tool => ({ ...tool, annotations: tool.annotations || { title: tool.title, ...READ_ONLY } }))

/** Error whose message is meant for the agent (returned as a tool error, not a protocol error). */
class ToolError extends Error {}

function matches(value, query) {
  return String(value || '').toLowerCase() === String(query || '').toLowerCase()
}

/**
 * @param options.request (path, { headers }) => Promise<parsed JSON>; throws on HTTP errors
 * @param options.version server version reported to clients
 */
/**
 * What initialize tells the agent about the KUA it reads, so a closed KUA or
 * an MCP server older than KUA is explained before any tool fails.
 */
export function connectionNote(kua, version) {
  if (!kua) return ''
  if (!kua.reachable) return `KUA is not running at ${kua.url}: ask the user to open KuaDashboard (every tool fails until it is open).`
  const note = `Connected to KUA${kua.version ? ` ${kua.version}` : ''} at ${kua.url}.`
  return kua.version && kua.version !== version
    ? `${note} This MCP server is ${version}: restart the agent session so it uses the server of the KUA version that is running.`
    : note
}

/**
 * @param options.locate  async () => { url, version, reachable, source }: the KUA this server reads (optional)
 */
export function createKuaMcp({ request, version = '0.0.0', now = () => Date.now(), locate = null }) {
  if (typeof request !== 'function') throw new Error('request is required')

  async function profiles(provider) {
    const list = await request('/api/cloud/envs/profiles')
    return (Array.isArray(list) ? list : [])
      .filter(profile => !provider || profile.provider === provider)
      .map(({ id, name, provider: kind, category }) => ({ id, name, provider: kind, ...(category ? { category } : {}) }))
  }

  /**
   * Profiles of the CLIs on this computer (~/.aws/config, gcloud configurations),
   * which KUA uses directly as "local:<name>". Names only, never credentials.
   */
  async function localProfiles(provider) {
    const sources = {
      aws: ['/api/cloud/aws/local-profiles', item => ({ region: item.region ?? null })],
      gcp: ['/api/cloud/gcp/gcloud-configs', item => ({ project: item.project ?? null })],
    }
    if (!sources[provider]) return []
    const [path, extra] = sources[provider]
    const list = await request(path).catch(() => [])
    return (Array.isArray(list) ? list : []).filter(item => item?.name)
      .map(item => ({ id: `local:${item.name}`, name: item.name, provider, source: 'local', ...extra(item) }))
  }

  const ADD_PROFILE = 'Add one in KUA with the key icon of the top bar (Env Manager)'
  const CLI_FILE = { aws: '~/.aws/config', gcp: 'gcloud configurations' }
  const listed = list => list.map(p => `${p.name} (${p.id})`).join(', ')

  /** A KUA profile by id or name, else a CLI profile of this computer by name. */
  async function resolveProfile(provider, query) {
    const list = await profiles(provider)
    const label = provider.toUpperCase()
    if (query) {
      const found = list.find(p => matches(p.id, query)) || list.find(p => matches(p.name, query))
      if (found) return found
      const local = await localProfiles(provider)
      const cli = local.find(p => matches(p.id, query)) || local.find(p => matches(p.name, query))
      if (cli) return cli
      throw new ToolError(`No ${label} profile "${query}". In KUA: ${listed(list) || 'none'}. On this computer (${CLI_FILE[provider] || 'CLI'}): ${listed(local) || 'none'}.`)
    }
    if (list.length === 1) return list[0]
    if (list.length > 1) throw new ToolError(`Several ${label} profiles exist; pass "profile" with one of: ${listed(list)}`)
    const local = await localProfiles(provider)
    if (local.length === 1) return local[0]
    if (local.length > 1) throw new ToolError(`KUA has no ${label} profile, but this computer has ${local.length} in ${CLI_FILE[provider]}: pass "profile" with one of ${local.map(p => p.name).join(', ')}. To keep one in KUA: ${ADD_PROFILE.toLowerCase()}.`)
    throw new ToolError(`KUA has no ${label} profile${CLI_FILE[provider] ? ` and none was found in ${CLI_FILE[provider]}` : ''}. ${ADD_PROFILE}.`)
  }

  async function applications() {
    const list = await request('/api/architecture/applications/catalog')
    return Array.isArray(list) ? list : []
  }

  /**
   * A KUA Application through the KUApps service (the one the UI uses), by id or name. The
   * application decides its scopes: nothing here falls back to the AWS profile selected in KUA.
   */
  async function kuaApplication(query) {
    if (!query) throw new ToolError('"application" is required (see list_applications).')
    const list = await request('/api/kua-apps/applications')
    const all = Array.isArray(list) ? list : []
    const byId = all.filter(item => matches(item.id, query))
    const found = byId.length ? byId : all.filter(item => matches(item.name, query))
    if (!found.length) throw new ToolError(`No KUA Application "${query}". Available: ${all.map(app => `${app.name} (${app.id})`).join(', ') || 'none; create one in KUApps'}.`)
    if (found.length > 1) throw new ToolError(`Several KUA Applications are named "${query}"; pass the id: ${found.map(app => `${app.id} (${app.environment || 'no environment'})`).join(', ')}.`)
    return found[0]
  }
  const appPath = (app, suffix = '') => `/api/kua-apps/applications/${encodeURIComponent(app.id)}${suffix}`
  const countBy = (items, key) => items.reduce((counts, item) => {
    const value = key(item) || 'unknown'
    counts[value] = (counts[value] || 0) + 1
    return counts
  }, {})

  const headersFor = profile => ({ 'X-Profile-Id': profile.id })
  const json = value => JSON.stringify(value, null, 2)

  function advisorOutput(report, args, context, lens = 'technical') {
    if (report?.error) throw new ToolError(`KUA could not build the Advisor report: ${report.error}`)
    // Free plan: KUA only shares the counts (lib/plans.js gateAdvisor).
    if (report?.locked) {
      const { findings, high, medium, low } = report.totals || {}
      throw new ToolError(`The KUA Advisor is part of the Pro plan. This scan found ${findings ?? 0} finding(s): ${high ?? 0} high, ${medium ?? 0} medium, ${low ?? 0} low. Upgrade the KUA account (or set KUA_PLAN=pro on this computer until accounts are linked) to see them.`)
    }
    if (args.format === 'json') return json(report)
    const t = translator(args.lang)
    const labelled = Object.fromEntries(Object.entries(context).map(([key, value]) => [t(`agentBrief.field.${key}`), value]))
    return advisorBrief(report, { t, lens, context: labelled, now: now() })
  }

  const handlers = {
    // A provider without KUA profiles also lists the CLI profiles of this computer (source "local"), usable as is.
    async list_profiles(args) {
      const list = await profiles(args.provider)
      const empty = ['aws', 'gcp'].filter(provider => (!args.provider || args.provider === provider) && !list.some(p => p.provider === provider))
      const local = (await Promise.all(empty.map(localProfiles))).flat()
      return json([...list, ...local])
    },

    async aws_advisor(args) {
      const profile = await resolveProfile('aws', args.profile)
      const report = await request(`/api/cloud/aws/overview/advisor${args.refresh ? '?refresh=1' : ''}`, { headers: headersFor(profile) })
      return advisorOutput(report, args, { profile: profile.name })
    },

    async gcp_advisor(args) {
      const profile = await resolveProfile('gcp', args.profile)
      const overview = await request('/api/cloud/gcp/overview', { headers: headersFor(profile) })
      if (!overview?.advisor) throw new ToolError('The GCP overview has no Advisor report yet. Open the GCP overview in KUA once.')
      return advisorOutput(overview.advisor, args, { profile: profile.name })
    },

    async vercel_advisor(args) {
      const profile = await resolveProfile('vercel', args.profile)
      const report = await request(`/api/cloud/vercel/advisor${args.refresh ? '?refresh=1' : ''}`, { headers: headersFor(profile) })
      return advisorOutput(report, args, { profile: profile.name })
    },

    async kubernetes_advisor(args) {
      const namespace = args.namespace || 'all'
      const [overview, contexts] = await Promise.all([
        request(`/api/overview?namespace=${encodeURIComponent(namespace)}`),
        request('/api/contexts').catch(() => null),
      ])
      if (!overview?.advisor) throw new ToolError('KUA returned no Kubernetes Advisor report. Check that a cluster context is selected in KUA.')
      return advisorOutput(overview.advisor, args, { context: contexts?.current })
    },

    async list_log_groups(args) {
      const profile = await resolveProfile('aws', args.profile)
      const cache = await request('/api/cloud/aws/cloudwatch/log-cache', { headers: headersFor(profile) })
      return json({
        profile: profile.name,
        region: cache?.region ?? null,
        groups: (cache?.groups || []).filter(Boolean).map(group => group.logGroup),
      })
    },

    async log_intelligence(args) {
      if (!args.group) throw new ToolError('"group" is required (see list_log_groups).')
      const profile = await resolveProfile('aws', args.profile)
      const data = await request(`/api/cloud/aws/cloudwatch/log-intelligence?group=${encodeURIComponent(args.group)}`, { headers: headersFor(profile) })
      if (args.format === 'json') return json(data)
      const t = translator(args.lang)
      return logsBrief(data, { t, group: args.group, context: { [t('agentBrief.field.profile')]: profile.name }, now: now() })
    },

    async search_logs(args) {
      if (!args.query) throw new ToolError('"query" is required.')
      const params = new URLSearchParams({ q: args.query, limit: String(args.limit || 10) })
      if (args.group) params.set('group', args.group)
      if (args.provider === 'kubernetes') {
        const data = await request(`/api/kube-logs/log-intelligence/search?${params}`)
        return json({ context: data?.context ?? null, query: args.query, results: data?.results || [] })
      }
      const profile = await resolveProfile('aws', args.profile)
      const data = await request(`/api/cloud/aws/cloudwatch/log-intelligence/search?${params}`, { headers: headersFor(profile) })
      return json({ profile: profile.name, region: data?.region ?? null, query: args.query, results: data?.results || [] })
    },

    async list_kube_log_workloads() {
      const cache = await request('/api/kube-logs/log-cache')
      return json({
        context: cache?.context ?? null,
        workloads: (cache?.groups || []).filter(Boolean).map(group => ({ group: group.logGroup, events: group.events ?? 0, bytes: group.bytes ?? 0, lastSyncAt: group.lastSyncAt ?? null })),
      })
    },

    async kube_log_intelligence(args) {
      if (!args.group) throw new ToolError('"group" is required (see list_kube_log_workloads).')
      const data = await request(`/api/kube-logs/log-intelligence?group=${encodeURIComponent(args.group)}`)
      if (args.format === 'json') return json(data)
      const t = translator(args.lang)
      return logsBrief(data, { t, group: args.group, context: { [t('agentBrief.field.provider')]: 'kubernetes' }, now: now() })
    },

    async list_applications() {
      const list = await applications()
      return json(list.map(app => ({ id: app.id, name: app.name, provider: app.provider ?? null, environment: app.environment ?? null, region: app.region ?? null })))
    },

    async product_advisor(args) {
      if (!args.application) throw new ToolError('"application" is required (see list_applications).')
      const list = await applications()
      const candidates = list.filter(item => matches(item.id, args.application))
      const named = candidates.length ? candidates : list.filter(item => matches(item.name, args.application))
      if (!named.length) throw new ToolError(`No application "${args.application}". Available: ${list.map(app => `${app.name} (${app.id})`).join(', ') || 'none'}`)
      if (named.length > 1) throw new ToolError(`Several applications are named "${args.application}"; pass the id: ${named.map(app => `${app.id} (${app.environment || app.provider})`).join(', ')}`)
      const [app] = named
      const report = await request(`/api/architecture/applications/${encodeURIComponent(app.id)}/advisor`, { headers: { 'X-Profile-Id': app.profileId } })
      return advisorOutput(report, args, { application: app.name, provider: app.provider }, 'product')
    },
  }

  // ── KUA Applications (#154): the KUApps contract, read-only ───────────────
  Object.assign(handlers, {
    async get_application(args) {
      const app = await kuaApplication(args.application)
      const [registry, views] = await Promise.all([request(appPath(app, '/registry')), request(appPath(app, '/views'))])
      const bindings = new Map((app.local?.bindings || []).map(binding => [binding.scopeKey, binding]))
      const resources = registry?.resources || []
      const relationships = registry?.relationships || []
      return json({
        contractVersion: app.contractVersion,
        id: app.id,
        name: app.name,
        environment: app.environment || null,
        team: app.team || null,
        revision: app.revision,
        updatedAt: app.updatedAt || null,
        // Only whether this computer can read each scope; the profile is local and stays out.
        scopes: (app.scopes || []).map(scope => ({
          provider: scope.provider, scopeId: scope.scopeId || null, location: scope.location || null, label: scope.label || null,
          access: bindings.get(scope.key)?.status || 'unbound',
        })),
        legacy: app.local?.legacy ? { provider: app.local.legacy.provider, region: app.local.legacy.region } : null,
        views: (views || []).map(view => view.missing ? { id: view.projectId, missing: true } : { id: view.projectId, name: view.name, revision: view.revision, updatedAt: view.updatedAt, nodes: view.nodes, edges: view.edges }),
        resources: { total: resources.length, bySignalState: countBy(resources, item => item.signals?.state) },
        relationships: { total: relationships.length, byStatus: countBy(relationships, item => item.status) },
        registryReconciledAt: registry?.syncStatus?.lastSuccessAt || null,
        warnings: app.warnings || [],
        notes: [
          'Signal states come from data KUA already collected; nothing here reads the cloud.',
          resources.length ? null : 'The application has no resources yet: add them in KUApps (Add resources).',
          (views || []).length ? null : 'The application has no architecture view.',
        ].filter(Boolean),
      })
    },

    async list_application_resources(args) {
      const app = await kuaApplication(args.application)
      const registry = await request(appPath(app, '/registry'))
      const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500)
      const all = (registry?.resources || [])
        .filter(item => !args.state || (item.signals?.state || 'unknown') === args.state)
        .filter(item => !args.provider || matches(item.provider, args.provider))
      const page = all.slice(0, limit)
      const ids = new Set(page.map(item => item.id))
      const relationships = (registry?.relationships || []).filter(item => ids.has(item.sourceResourceId) || ids.has(item.targetResourceId))
      return json({
        application: { id: app.id, name: app.name, revision: app.revision },
        registryReconciledAt: registry?.syncStatus?.lastSuccessAt || null,
        total: all.length,
        truncated: all.length > page.length,
        resources: page.map(item => ({
          id: item.id,
          name: item.displayName,
          provider: item.provider,
          resourceType: item.resourceType,
          scope: { scopeId: item.scopeId || null, location: item.location || null, ...(item.provider === 'kubernetes' ? { kubeContext: item.kubeContext || null, namespace: item.namespace || null } : {}) },
          nativeIdentifier: item.nativeIdentifier,
          sources: item.sources || [],
          signals: item.signals
            ? { state: item.signals.state, lastDataAt: item.signals.lastDataAt || null, ...(item.signals.reason ? { reason: item.signals.reason } : {}) }
            : { state: 'unknown', note: 'This KUA did not report a signal state.' },
          updatedAt: item.updatedAt || null,
          relationships: relationships
            .filter(relationship => relationship.sourceResourceId === item.id || relationship.targetResourceId === item.id)
            .map(relationship => relationship.sourceResourceId === item.id
              ? { direction: 'out', relationType: relationship.relationType, status: relationship.status, other: relationship.targetName || relationship.targetResourceId }
              : { direction: 'in', relationType: relationship.relationType, status: relationship.status, other: relationship.sourceName || relationship.sourceResourceId }),
        })),
      })
    },

    async get_architecture_graph(args) {
      const app = await kuaApplication(args.application)
      const views = (await request(appPath(app, '/views'))) || []
      const available = views.filter(view => !view.missing)
      if (!available.length) throw new ToolError(`"${app.name}" has no architecture view. Add resources in KUApps (Add resources) to create one.`)
      let view = available[0]
      if (args.view) {
        view = available.find(item => matches(item.projectId, args.view)) || available.find(item => matches(item.name, args.view))
        if (!view) throw new ToolError(`"${app.name}" has no view "${args.view}". Its views: ${available.map(item => `${item.name} (${item.projectId})`).join(', ')}.`)
      }
      const graph = await request(appPath(app, `/views/${encodeURIComponent(view.projectId)}/graph`))
      const limit = Math.min(Math.max(Number(args.limit) || 300, 1), 1000)
      const allNodes = graph?.document?.nodes || []
      const nodes = allNodes.slice(0, limit)
      const ids = new Set(nodes.map(node => node.id))
      const allEdges = graph?.document?.edges || []
      const edges = allEdges.filter(edge => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId))
      const evidenceKinds = evidence => [...new Set((Array.isArray(evidence) ? evidence : []).map(item => item?.type || item?.kind).filter(Boolean))]
      return json({
        application: { id: app.id, name: app.name, revision: app.revision },
        view: { id: graph.projectId, name: graph.name, revision: graph.revision, updatedAt: graph.updatedAt },
        note: 'The stored view at this revision, not a live read of the cloud. Evidence is history: verify the current state before acting on it.',
        totals: { nodes: allNodes.length, edges: allEdges.length },
        truncated: allNodes.length > nodes.length,
        nodes: nodes.map(node => ({
          id: node.id, name: node.name, provider: node.provider || null, resourceType: node.resourceType || node.kind || null,
          registryResourceId: node.registryResourceId || null,
          scope: { accountId: node.accountId || null, region: node.region || node.location || null, kubeContext: node.kubeContext || null, namespace: node.namespace || null },
          ...(node.hidden ? { hidden: true } : {}),
          ...(node.manual ? { manual: true } : {}),
        })),
        edges: edges.map(edge => ({
          id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId,
          relationType: edge.relationType || 'depends_on', status: edge.status || 'suggested',
          confidence: edge.confidence ?? null, decision: edge.decision || null,
          evidence: evidenceKinds(edge.evidence),
          registryRelationshipId: edge.registryRelationshipId || null,
        })),
      })
    },
  })

  // ── KUApps changes (#155): preview, then apply what the user approved ─────
  Object.assign(handlers, {
    async preview_application_change(args) {
      if (!CHANGE_OPERATIONS.includes(args.operation)) throw new ToolError(`"operation" must be one of: ${CHANGE_OPERATIONS.join(', ')}.`)
      const app = args.operation === 'application.create' ? null : await kuaApplication(args.application)
      const plan = await request('/api/kua-apps/changes/preview', {
        method: 'POST', headers: ACTOR,
        body: { applicationId: app?.id, operation: args.operation, input: args.input || {} },
      })
      return json({
        ...plan,
        next: plan.agentWrites
          ? 'Show this preview to the user. Only if they approve, call apply_application_change with this planId and confirm true.'
          : 'Show this preview to the user. Applying is off in KUA: the user can allow it in KUA (Connect an AI agent → Allow agents to change KUApps).',
      })
    },

    async apply_application_change(args) {
      if (!args.planId) throw new ToolError('"planId" is required (from preview_application_change).')
      if (args.confirm !== true) throw new ToolError('Pass confirm true only after the user approved the preview.')
      return json(await request(`/api/kua-apps/changes/${encodeURIComponent(args.planId)}/apply`, { method: 'POST', headers: ACTOR, body: { confirm: true } }))
    },

    async get_application_change(args) {
      if (!args.planId) throw new ToolError('"planId" is required.')
      return json(await request(`/api/kua-apps/changes/${encodeURIComponent(args.planId)}`))
    },
  })

  async function callTool(name, args = {}) {
    const handler = handlers[name]
    if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    try {
      return { content: [{ type: 'text', text: await handler(args || {}) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: err.message || String(err) }], isError: true }
    }
  }

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

  /** One JSON-RPC message in, its response out (null for notifications). */
  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return message && 'id' in message ? fail(message.id ?? null, -32600, 'Invalid request') : null
    }
    const { id, method, params = {} } = message
    const isNotification = !('id' in message)
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion
        const kua = locate ? await locate().catch(() => null) : null
        return ok(id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'kua', title: 'KUA (Know Unified Administration)', version },
          instructions: [INSTRUCTIONS, connectionNote(kua, version)].filter(Boolean).join(' '),
          ...(kua ? { _meta: { kua } } : {}),
        })
      }
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, { tools: TOOLS })
      case 'tools/call':
        if (typeof params.name !== 'string') return fail(id, -32602, 'Missing tool name')
        return ok(id, await callTool(params.name, params.arguments))
      default:
        return isNotification ? null : fail(id, -32601, `Method not found: ${method}`)
    }
  }

  return { handle, callTool }
}

/**
 * request() against a running KUA. Errors are written for the agent: KUA not
 * running, or the message KUA returned.
 */
export function httpRequest(baseUrl, { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  return async (path, { headers = {}, method = 'GET', body: payload } = {}) => {
    let response
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        method, headers: { Accept: 'application/json', ...headers },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // `unreachable`: mcp/server.mjs looks for the running KUA again (it may have restarted on another port).
      throw Object.assign(new ToolError(`KUA is not reachable at ${baseUrl} (${err.cause?.code || err.name || err.message}). Open KuaDashboard, or set KUA_URL to the address where it runs.`), { unreachable: true })
    }
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { /* not JSON */ }
    if (!response.ok) {
      // The code and current revision tell the agent what to do next (preview again, ask the user…).
      const detail = [body?.code, body?.revision !== undefined ? `current revision ${body.revision}` : null].filter(Boolean).join(', ')
      throw new ToolError(`KUA answered ${response.status}${detail ? ` (${detail})` : ''}: ${body?.error || text.slice(0, 300) || response.statusText}`)
    }
    return body
  }
}
