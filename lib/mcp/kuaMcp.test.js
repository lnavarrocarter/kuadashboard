 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const load = () => import('./kuaMcp.mjs');
const NOW = Date.parse('2026-10-02T10:00:00Z');

const PROFILES = [
  { id: 'p-aws-1', name: 'prod', provider: 'aws', keyNames: ['AWS_SECRET_ACCESS_KEY'], meta: {} },
  { id: 'p-aws-2', name: 'dev', provider: 'aws', keyNames: [], meta: {} },
  { id: 'p-gcp', name: 'analytics', provider: 'gcp', keyNames: ['GCP_KEY'], meta: {} },
  { id: 'p-vercel', name: 'web', provider: 'vercel', keyNames: ['VERCEL_API_TOKEN'], meta: {} },
];

const ADVISOR = {
  generatedAt: '2026-10-02T09:00:00Z',
  scope: { provider: 'aws', region: 'us-east-1' },
  categories: ['security'],
  summary: {},
  findings: [{ id: 'aws.root_mfa', category: 'security', severity: 'high', count: 1, params: {}, docs: 'https://docs.aws.amazon.com/x', resources: [{ kind: 'Account', name: 'root' }], truncated: false }],
  unavailable: [],
};

/** Fake KUA API: records calls, answers by path. */
function fakeKua(routes) {
  const calls = [];
  const request = async (url, options = {}) => {
    const { headers = {} } = options;
    const pathname = url.split('?')[0];
    if (!(pathname in routes)) throw new Error(`unexpected ${url}`);
    const value = routes[pathname];
    calls.push({ url, headers, method: options.method || 'GET', body: options.body, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
    return typeof value === 'function' ? value(url, headers) : value;
  };
  return { request, calls };
}

async function server(routes) {
  const { createKuaMcp } = await load();
  const kua = fakeKua({ '/api/cloud/envs/profiles': PROFILES, ...routes });
  return { mcp: createKuaMcp({ request: kua.request, version: '9.9.9', now: () => NOW }), calls: kua.calls };
}

const text = result => result.content.map(item => item.text).join('\n');

test('initialize negotiates the protocol version and lists read-only tools', async () => {
  const { mcp } = await server({});
  const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'kua');
  assert.equal(init.result.serverInfo.version, '9.9.9');
  assert.ok(init.result.capabilities.tools);

  const unknownVersion = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  const { SUPPORTED_PROTOCOL_VERSIONS } = await load();
  assert.equal(unknownVersion.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);

  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual((await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});

  const { result } = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.ok(result.tools.length >= 8);
  // Only apply_application_change writes (#155), and hosts are told so to ask for confirmation.
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    const writes = tool.name === 'apply_application_change';
    assert.equal(tool.annotations.readOnlyHint, !writes, tool.name);
    assert.equal(tool.annotations.destructiveHint, writes, tool.name);
  }
});

test('unknown methods and malformed messages get JSON-RPC errors', async () => {
  const { mcp } = await server({});
  assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).error.code, -32601);
  assert.equal((await mcp.handle({ id: 2, method: 'x' })).error.code, -32600);
  assert.equal((await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} })).error.code, -32602);
  const unknownTool = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(unknownTool.result.isError, true);
});

test('list_profiles never returns credential key names or metadata', async () => {
  const { mcp } = await server({});
  const result = await mcp.callTool('list_profiles', { provider: 'aws' });
  const profiles = JSON.parse(text(result));
  assert.deepEqual(profiles, [{ id: 'p-aws-1', name: 'prod', provider: 'aws' }, { id: 'p-aws-2', name: 'dev', provider: 'aws' }]);
  assert.doesNotMatch(text(result), /SECRET|keyNames/);
});

test('aws_advisor resolves the profile by name and returns the Markdown brief', async () => {
  const { mcp, calls } = await server({ '/api/cloud/aws/overview/advisor': ADVISOR });
  const result = await mcp.callTool('aws_advisor', { profile: 'PROD', refresh: true });
  assert.equal(result.isError, undefined);
  const md = text(result);
  assert.match(md, /^# KUA brief: good-practice findings/);
  assert.match(md, /- \*\*Profile:\*\* `prod`/);
  assert.match(md, /- \*\*Region:\*\* `us-east-1`/);
  assert.match(md, /\[HIGH\] The root user has no MFA/);
  const call = calls.find(c => c.url.startsWith('/api/cloud/aws/overview/advisor'));
  assert.equal(call.url, '/api/cloud/aws/overview/advisor?refresh=1');
  assert.equal(call.headers['X-Profile-Id'], 'p-aws-1');
});

test('aws_advisor asks for a profile when several exist, and supports JSON and Spanish', async () => {
  const { mcp } = await server({ '/api/cloud/aws/overview/advisor': ADVISOR });
  const ambiguous = await mcp.callTool('aws_advisor', {});
  assert.equal(ambiguous.isError, true);
  assert.match(text(ambiguous), /prod \(p-aws-1\), dev \(p-aws-2\)/);

  const missing = await mcp.callTool('aws_advisor', { profile: 'staging' });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /No AWS profile "staging"/);

  assert.deepEqual(JSON.parse(text(await mcp.callTool('aws_advisor', { profile: 'dev', format: 'json' }))), ADVISOR);
  assert.match(text(await mcp.callTool('aws_advisor', { profile: 'dev', lang: 'es' })), /^# Brief de KUA/);
});

test('gcp_advisor reports cached provenance and can force a fresh overview', async () => {
  const { mcp, calls } = await server({ '/api/cloud/gcp/overview': { advisor: { ...ADVISOR, scope: { provider: 'gcp', projectId: 'acme' }, findings: [] } } });
  const md = text(await mcp.callTool('gcp_advisor', {}));
  assert.match(md, /- \*\*Project:\*\* `acme`/);
  assert.match(md, /Every check passes/);
  assert.equal(calls.at(-1).headers['X-Profile-Id'], 'p-gcp');

  const cached = await server({ '/api/cloud/gcp/overview': { fromCache: true, advisor: { ...ADVISOR, scope: { provider: 'gcp', projectId: 'acme' }, findings: [] } } });
  assert.match(text(await cached.mcp.callTool('gcp_advisor', { lang: 'es' })), /Vigencia de los datos.*Snapshot en caché/);
  await cached.mcp.callTool('gcp_advisor', { refresh: true, format: 'json' });
  assert.equal(cached.calls.at(-1).url, '/api/cloud/gcp/overview?force=1');
  assert.equal(cached.calls.at(-1).headers['X-Profile-Id'], 'p-gcp');

  const fresh = await server({ '/api/cloud/gcp/overview': { fromCache: false, advisor: { ...ADVISOR, scope: { provider: 'gcp', projectId: 'acme' }, findings: [] } } });
  assert.match(text(await fresh.mcp.callTool('gcp_advisor', {})), /Data freshness.*Fresh scan/);
});

test('vercel_advisor reads the Vercel Advisor of the single Vercel profile', async () => {
  const { mcp, calls } = await server({ '/api/cloud/vercel/advisor': { ...ADVISOR, scope: { provider: 'vercel', teamId: 'team_1' } } });
  const md = text(await mcp.callTool('vercel_advisor', { refresh: true }));
  assert.match(md, /- \*\*Team:\*\* `team_1`/);
  assert.equal(calls.at(-1).url, '/api/cloud/vercel/advisor?refresh=1');
  assert.equal(calls.at(-1).headers['X-Profile-Id'], 'p-vercel');
});

test('kubernetes_advisor adds the current context and reports Advisor errors', async () => {
  const { mcp, calls } = await server({
    '/api/overview': { advisor: { ...ADVISOR, scope: { provider: 'kubernetes', namespace: 'shop' } } },
    '/api/contexts': { current: 'prod-cluster' },
  });
  const md = text(await mcp.callTool('kubernetes_advisor', { namespace: 'shop' }));
  assert.match(md, /- \*\*Kubernetes context:\*\* `prod-cluster`/);
  assert.ok(calls.some(c => c.url === '/api/overview?namespace=shop'));

  const failing = await server({ '/api/overview': { advisor: { error: 'forbidden' } }, '/api/contexts': {} });
  const result = await failing.mcp.callTool('kubernetes_advisor', {});
  assert.equal(result.isError, true);
  assert.match(text(result), /forbidden/);
});

test('log tools list cached groups and brief their intelligence', async () => {
  const { mcp, calls } = await server({
    '/api/cloud/aws/cloudwatch/log-cache': { region: 'us-east-1', groups: [{ logGroup: '/aws/lambda/orders' }, null] },
    '/api/cloud/aws/cloudwatch/log-intelligence': {
      eventsAnalyzed: 10,
      last24h: { events: 10, errors: 2, warnings: 0, errorRatePercent: 20 },
      recommendations: [{ id: 'cost_retention', kind: 'cost', severity: 'low', confidence: 0.9, params: { logGroup: '/aws/lambda/orders' }, evidence: {}, actions: [] }],
      signatures: [], references: [],
    },
  });
  assert.deepEqual(JSON.parse(text(await mcp.callTool('list_log_groups', { profile: 'p-aws-2' }))), { profile: 'dev', region: 'us-east-1', groups: ['/aws/lambda/orders'] });

  const md = text(await mcp.callTool('log_intelligence', { profile: 'dev', group: '/aws/lambda/orders' }));
  assert.match(md, /^# KUA brief: log intelligence for \/aws\/lambda\/orders/);
  assert.match(md, /\| 24 h \| 10 \| 2 \| 0 \| 20% \|/);
  assert.equal(calls.at(-1).url, '/api/cloud/aws/cloudwatch/log-intelligence?group=%2Faws%2Flambda%2Forders');

  const noGroup = await mcp.callTool('log_intelligence', { profile: 'dev' });
  assert.equal(noGroup.isError, true);
});

test('product_advisor finds the application in the catalog and uses its profile', async () => {
  const catalog = [
    { id: 'app-1', name: 'orders', provider: 'aws', environment: 'prod', profileId: 'p-aws-1' },
    { id: 'app-2', name: 'orders', provider: 'aws', environment: 'dev', profileId: 'p-aws-2' },
    { id: 'app-3', name: 'web', provider: 'kubernetes', environment: 'prod', profileId: 'local:ctx' },
  ];
  const apps = [
    { id: 'app-1', name: 'orders', environment: 'prod', scopes: [{ provider: 'aws' }], local: { bindings: [{ profileId: 'p-aws-1', status: 'verified' }] } },
    { id: 'app-2', name: 'orders', environment: 'dev', scopes: [{ provider: 'aws' }], local: { bindings: [{ profileId: 'p-aws-2', status: 'verified' }] } },
    { id: 'app-3', name: 'web', environment: 'prod', scopes: [{ provider: 'kubernetes' }], local: { bindings: [{ profileId: 'local:ctx', status: 'verified' }] } },
  ];
  const { mcp, calls } = await server({
    '/api/architecture/applications/catalog': catalog,
    '/api/kua-apps/applications': apps,
    '/api/architecture/applications/app-3/advisor': { ...ADVISOR, categories: ['product'], scope: { provider: 'kubernetes', applicationId: 'app-3' }, findings: [] },
  });
  assert.equal(JSON.parse(text(await mcp.callTool('list_applications'))).length, 3);

  const ambiguous = await mcp.callTool('product_advisor', { application: 'orders' });
  assert.equal(ambiguous.isError, true);
  assert.match(text(ambiguous), /app-1 \(prod\), app-2 \(dev\)/);

  const md = text(await mcp.callTool('product_advisor', { application: 'web' }));
  assert.match(md, /^# KUA brief: product findings/);
  assert.match(md, /- \*\*Application:\*\* `web`/);
  assert.equal(calls.at(-1).headers['X-Profile-Id'], 'local:ctx');
});

test('product_advisor refuses a KUApps application without a verified local profile binding', async () => {
  const { mcp, calls } = await server({
    '/api/kua-apps/applications': [{ id: 'app-1', name: 'orders', local: { bindings: [{ profileId: 'p-aws-1', status: 'mismatch' }] }, scopes: [{ provider: 'aws' }] }],
  });
  const result = await mcp.callTool('product_advisor', { application: 'orders' });
  assert.equal(result.isError, true);
  assert.match(text(result), /has no verified local profile binding/);
  assert.equal(calls.some(call => call.url.includes('/advisor')), false);
});

test('httpRequest explains when KUA is not running and relays KUA errors', async () => {
  const { httpRequest } = await load();
  const down = httpRequest('http://127.0.0.1:1', { fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  await assert.rejects(down('/api/x'), /KUA is not reachable at http:\/\/127.0.0.1:1 \(ECONNREFUSED\)/);

  const failing = httpRequest('http://kua', { fetchImpl: async () => new Response(JSON.stringify({ error: 'Log group is not cached' }), { status: 404 }) });
  await assert.rejects(failing('/api/x'), /KUA answered 404: Log group is not cached/);

  // Every request says it comes from an agent, and a plan refusal tells the agent to stop and ask the user.
  let sent = null
  const free = httpRequest('http://kua', { fetchImpl: async (url, options) => {
    sent = options.headers
    return new Response(JSON.stringify({ error: 'Using KUA from an AI agent (MCP) is part of the Pro and Team plans', code: 'PLAN_REQUIRED', required: 'pro' }), { status: 403 })
  } });
  await assert.rejects(free('/api/kua-apps/applications'), /part of the Pro and Team plans\. Tell the user: it needs the Pro plan, available in KUA → Help & Options → Account\. Do not retry\./);
  assert.equal(sent['X-KUA-Actor'], 'mcp');
});

test('stdio server answers initialize and tools/call against a running KUA', async () => {
  const kua = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/cloud/envs/profiles') return res.end(JSON.stringify(PROFILES));
    if (req.url === '/api/cloud/aws/overview/advisor' && req.headers['x-profile-id'] === 'p-aws-2') return res.end(JSON.stringify(ADVISOR));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise(resolve => kua.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'server.mjs')], {
    env: { ...process.env, KUA_URL: `http://127.0.0.1:${kua.address().port}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    child.stdin.write('not json\n');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'aws_advisor', arguments: { profile: 'dev' } } })}\n`);
    child.stdin.end();
    await new Promise(resolve => child.on('exit', resolve));

    const messages = output.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(messages.length, 3);
    assert.equal(messages.find(m => m.id === 1).result.serverInfo.name, 'kua');
    assert.equal(messages.find(m => m.id === null).error.code, -32700);
    assert.match(messages.find(m => m.id === 2).result.content[0].text, /The root user has no MFA/);
  } finally {
    child.kill();
    kua.close();
  }
});

test('search_logs passes the query to KUA and relays a disabled Local ML', async () => {
  const { mcp, calls } = await server({
    '/api/cloud/aws/cloudwatch/log-intelligence/search': url => (url.includes('q=permisos')
      ? { region: 'us-east-1', results: [{ logGroup: '/g', signature: 'AccessDenied', occurrences: 3, score: 0.53 }] }
      : (() => { throw new Error('KUA answered 409: Local ML is disabled. Enable it in KUA (Intelligence → Local ML).') })()),
  });
  const result = JSON.parse(text(await mcp.callTool('search_logs', { profile: 'dev', query: 'permisos denegados', group: '/g' })));
  assert.equal(result.results[0].signature, 'AccessDenied');
  assert.match(calls.at(-1).url, /q=permisos\+denegados&limit=10&group=%2Fg/);
  const disabled = await mcp.callTool('search_logs', { profile: 'dev', query: 'x' });
  assert.equal(disabled.isError, true);
  assert.match(text(disabled), /Local ML is disabled/);
});

test('Kubernetes log tools read the kube-logs API and brief a workload', async () => {
  const { mcp, calls } = await server({
    '/api/kube-logs/log-cache': { context: 'dev', groups: [{ logGroup: 'shop/deployments/api', events: 70, bytes: 1000, lastSyncAt: 1 }, null] },
    '/api/kube-logs/log-intelligence': { provider: 'kubernetes', eventsAnalyzed: 70, last24h: { events: 70, errors: 4, warnings: 0, errorRatePercent: 5.7 }, recommendations: [{ id: 'fix_database', kind: 'fix', category: 'database', severity: 'low', confidence: 0.65, params: { count: 4 }, evidence: {}, actions: [{ type: 'query', query: 'fields @message' }] }], signatures: [], references: [] },
    '/api/kube-logs/log-intelligence/search': { context: 'dev', results: [{ logGroup: 'shop/deployments/api', signature: 'Unable to connect to the database', score: 0.6 }] },
  });
  assert.deepEqual(JSON.parse(text(await mcp.callTool('list_kube_log_workloads'))), { context: 'dev', workloads: [{ group: 'shop/deployments/api', events: 70, bytes: 1000, lastSyncAt: 1 }] });
  const md = text(await mcp.callTool('kube_log_intelligence', { group: 'shop/deployments/api' }));
  assert.match(md, /^# KUA brief: log intelligence for shop\/deployments\/api/);
  assert.match(md, /Query \(Logs Insights syntax, runs on the KUA cache\)/);
  assert.match(md, /kubectl get pods/);
  assert.doesNotMatch(md, /CloudWatch Logs Insights query/);
  const found = JSON.parse(text(await mcp.callTool('search_logs', { provider: 'kubernetes', query: 'base de datos' })));
  assert.equal(found.results[0].logGroup, 'shop/deployments/api');
  assert.ok(calls.some(c => c.url.startsWith('/api/kube-logs/log-intelligence/search?q=base+de+datos')));
});

test('Kubernetes architecture tools list contexts and return filtered, bounded topology without event messages', async () => {
  const preview = {
    generatedAt: '2026-10-12T12:00:00.000Z',
    nodes: [
      { id: 'pod-1', resourceType: 'pod', kind: 'Pod', name: 'api-1', namespace: 'orders', kubeContext: 'eks-dev', health: { status: 'healthy', phase: 'Running', restarts: 0 } },
      { id: 'pv-1', resourceType: 'pv', kind: 'PersistentVolume', name: 'orders-data', namespace: '', kubeContext: 'eks-dev' },
    ],
    relationships: [
      { id: 'owns-1', sourceNodeId: 'deployment-1', targetNodeId: 'pod-1', relationType: 'owns', confidence: 1, evidence: [{ type: 'workload_selector', selector: { app: 'api' } }] },
      { id: 'runs-1', sourceNodeId: 'pod-1', targetNodeId: 'pv-1', relationType: 'runs_on', confidence: 1, evidence: [{ type: 'pod_node_assignment', values: ['private'] }] },
    ],
    health: [{ context: 'eks-dev', status: 'degraded', warningEvents: [{ name: 'api.1', reason: 'BackOff', namespace: 'orders', count: 3, regardingKind: 'Pod', regardingName: 'api-1', message: 'must not be returned' }] }],
    capabilities: [{ context: 'eks-dev', discovery: true, persistentVolumes: false }],
    failures: [],
  };
  const { mcp, calls } = await server({
    '/api/architecture/kubernetes/contexts': { contexts: [{ id: 'eks-dev', name: 'eks-dev', cluster: 'prod' }] },
    '/api/architecture/kubernetes/architecture/preview': preview,
  });

  assert.deepEqual(JSON.parse(text(await mcp.callTool('list_kubernetes_contexts'))), { contexts: [{ id: 'eks-dev', name: 'eks-dev', cluster: 'prod' }] });
  const result = JSON.parse(text(await mcp.callTool('kubernetes_architecture', {
    context: 'eks-dev', namespace: 'orders', resource_types: ['pod', 'pv'], limit: 10,
  })));
  assert.deepEqual(result.totals, { resources: 2, byType: { pod: 1, pv: 1 } });
  assert.deepEqual(result.nodes.map(node => node.type), ['pod', 'pv']);
  assert.deepEqual(result.relationships, [{ id: 'runs-1', source: 'pod-1', target: 'pv-1', type: 'runs_on', confidence: 1, evidence: ['pod_node_assignment'] }]);
  assert.equal(result.health[0].warningEvents[0].reason, 'BackOff');
  assert.doesNotMatch(JSON.stringify(result), /must not be returned|private/);
  assert.deepEqual(calls.find(call => call.url === '/api/architecture/kubernetes/architecture/preview'), {
    url: '/api/architecture/kubernetes/architecture/preview', headers: {}, method: 'POST', body: { context: 'eks-dev', namespace: 'orders' },
  });

  const limited = JSON.parse(text(await mcp.callTool('kubernetes_architecture', { resource_types: ['pod', 'pv'], limit: 1 })));
  assert.equal(limited.truncated, true);
  assert.equal(limited.nodes.length, 1);
  assert.equal(limited.relationships.length, 0);
});

test('cloud_resource_inventory searches AWS and GCP resources and sanitizes relationship evidence', async () => {
  const awsPreview = {
    generatedAt: '2026-10-12T12:00:00.000Z',
    scope: { provider: 'aws', accountId: '123456789012', region: 'us-east-1', profileId: 'private-profile-id' },
    nodes: [
      { id: 'lambda-1', name: 'orders-worker', provider: 'aws', resourceType: 'lambda', kind: 'AWS::Lambda::Function', arn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-worker', region: 'us-east-1' },
      { id: 'queue-1', name: 'orders-queue', provider: 'aws', resourceType: 'sqs', kind: 'AWS::SQS::Queue', arn: 'arn:aws:sqs:us-east-1:123456789012:orders-queue', region: 'us-east-1' },
    ],
    relationshipSuggestions: [{ sourceNodeId: 'lambda-1', targetNodeId: 'queue-1', relationType: 'triggers', confidence: 0.99, evidence: [{ type: 'lambda_event_source_mapping', eventSourceArn: 'private-evidence' }] }],
    relationshipAnalysis: { failures: [{ source: 'lambda-code', code: 'AccessDeniedException', message: 'private-profile-id private-error-detail' }] },
    estimate: { awsRequests: 20, truncated: false },
  };
  const gcpPreview = {
    scope: { provider: 'gcp', projectId: 'project-a', region: 'global', profileId: 'private-profile-id' },
    nodes: [{ id: 'run-1', name: 'orders-api', provider: 'gcp', resourceType: 'gcp-cloud-run', kind: 'gcp-cloud-run', nativeId: 'projects/project-a/services/orders-api', uri: 'https://orders.example', status: 'ready' }],
    relationships: [], failures: [], estimate: { requests: 2 },
  };
  const { mcp, calls } = await server({
    '/api/cloud/aws/account': { account: '123456789012', region: 'us-east-1' },
    '/api/architecture/clouds/aws/architecture/preview': awsPreview,
    '/api/architecture/clouds/gcp/architecture/preview': gcpPreview,
  });

  const aws = JSON.parse(text(await mcp.callTool('cloud_resource_inventory', {
    provider: 'aws', profile: 'dev', search: 'orders', resource_types: ['lambda'], stack_names: ['orders-stack'], scan_limit: 1200,
  })));
  assert.deepEqual(aws.totals, { resources: 1, byType: { lambda: 1 } });
  assert.equal(aws.scope.account, '123456789012');
  assert.equal(aws.resources[0].name, 'orders-worker');
  assert.deepEqual(aws.relationships, []);
  assert.deepEqual(aws.failures, [{ source: 'lambda-code', code: 'AccessDeniedException' }]);
  assert.doesNotMatch(JSON.stringify(aws), /private-profile-id|private-evidence|private-error-detail/);
  assert.deepEqual(calls.find(call => call.url === '/api/architecture/clouds/aws/architecture/preview').body, {
    accountId: '123456789012', region: 'us-east-1', includeIamRoleReferences: false, maxResources: 1200, stackNames: ['orders-stack'],
  });
  assert.equal(calls.find(call => call.url === '/api/architecture/clouds/aws/architecture/preview').timeoutMs, 300000);

  const gcp = JSON.parse(text(await mcp.callTool('cloud_resource_inventory', { provider: 'gcp', profile: 'analytics', search: 'orders' })));
  assert.equal(gcp.provider, 'gcp');
  assert.equal(gcp.scope.account, 'project-a');
  assert.equal(gcp.resources[0].details.uri, 'https://orders.example');
  assert.equal(calls.some(call => call.url === '/api/cloud/aws/account' && call.headers['X-Profile-Id'] === 'p-gcp'), false);

  const invalidIdentity = await server({
    '/api/cloud/aws/account': { account: null, region: 'us-east-1' },
  });
  const refused = await invalidIdentity.mcp.callTool('cloud_resource_inventory', { provider: 'aws', profile: 'dev' });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /could not verify the AWS account/);
});

test('cloud_resource_inventory paginates one filtered snapshot without rescanning and keeps cross-page relationships', async () => {
  const preview = {
    scope: { provider: 'gcp', projectId: 'project-a' },
    nodes: [
      { id: 'one', name: 'api-one', provider: 'gcp', resourceType: 'gcp-cloud-run', nativeId: 'one' },
      { id: 'two', name: 'api-two', provider: 'gcp', resourceType: 'gcp-cloud-run', nativeId: 'two' },
      { id: 'three', name: 'api-three', provider: 'gcp', resourceType: 'gcp-function', nativeId: 'three' },
    ],
    relationships: [
      { id: 'edge-one-two', sourceNodeId: 'one', targetNodeId: 'two', relationType: 'calls', evidence: [{ type: 'env_reference', value: 'private' }] },
      { id: 'edge-two-three', sourceNodeId: 'two', targetNodeId: 'three', relationType: 'calls', evidence: [{ type: 'env_reference', value: 'private' }] },
    ],
  };
  const { mcp, calls } = await server({ '/api/architecture/clouds/gcp/architecture/preview': preview });
  const first = JSON.parse(text(await mcp.callTool('cloud_resource_inventory', { provider: 'gcp', profile: 'analytics', limit: 1 })));
  assert.deepEqual(first.resources.map(resource => resource.id), ['one']);
  assert.equal(first.page.offset, 0);
  assert.ok(first.nextCursor);
  assert.deepEqual(first.relationships.map(edge => edge.source), ['one']);

  const second = JSON.parse(text(await mcp.callTool('cloud_resource_inventory', { provider: 'gcp', cursor: first.nextCursor, limit: 1 })));
  assert.deepEqual(second.resources.map(resource => resource.id), ['two']);
  assert.equal(second.page.offset, 1);
  assert.equal(second.profile, 'analytics');
  assert.equal(second.relationships.length, 2);
  assert.ok(second.nextCursor);

  const third = JSON.parse(text(await mcp.callTool('cloud_resource_inventory', { provider: 'gcp', cursor: second.nextCursor, limit: 1 })));
  assert.deepEqual(third.resources.map(resource => resource.id), ['three']);
  assert.equal(third.nextCursor, null);
  assert.equal(calls.filter(call => call.url === '/api/architecture/clouds/gcp/architecture/preview').length, 1);

  const reused = await mcp.callTool('cloud_resource_inventory', { provider: 'gcp', cursor: first.nextCursor, limit: 1 });
  assert.equal(reused.isError, true);
  assert.match(text(reused), /expired or was already used/);
});

test('check_profile probes AWS, GCP, Vercel and Kubernetes with safe statuses', async () => {
  const { mcp, calls } = await server({
    '/api/cloud/aws/account': { account: '123456789012', region: 'us-east-1' },
    '/api/architecture/clouds/gcp/architecture/preview': {
      scope: { projectId: 'project-a' },
      nodes: [{ resourceType: 'gcp-cloud-run' }, { resourceType: 'gcp-function' }],
    },
    '/api/cloud/vercel/projects': [{ id: 'project-1' }, { id: 'project-2' }],
    '/api/architecture/kubernetes/contexts': { contexts: [
      { id: 'eks-dev', name: 'eks-dev', cluster: 'dev-cluster' },
      { id: 'eks-prod', name: 'eks-prod', cluster: 'prod-cluster' },
    ] },
    '/api/architecture/kubernetes/check': { context: 'eks-dev', cluster: 'dev-cluster', status: 'permission_denied', check: 'apps/v1 deployments list', statusCode: 403 },
  });

  const aws = JSON.parse(text(await mcp.callTool('check_profile', { provider: 'aws', profile: 'dev' })));
  assert.equal(aws.status, 'connected');
  assert.equal(aws.scope.account, '123456789012');

  const gcp = JSON.parse(text(await mcp.callTool('check_profile', { provider: 'gcp', profile: 'analytics' })));
  assert.equal(gcp.status, 'connected');
  assert.equal(gcp.scope.project, 'project-a');
  assert.deepEqual(gcp.resources, { 'gcp-cloud-run': 1, 'gcp-function': 1 });

  const vercel = JSON.parse(text(await mcp.callTool('check_profile', { provider: 'vercel', profile: 'web' })));
  assert.equal(vercel.status, 'connected');
  assert.equal(vercel.projectCount, 2);

  const ambiguous = JSON.parse(text(await mcp.callTool('check_profile', { provider: 'kubernetes' })));
  assert.equal(ambiguous.status, 'selection_required');
  const kube = JSON.parse(text(await mcp.callTool('check_profile', { provider: 'kubernetes', context: 'eks-dev' })));
  assert.equal(kube.status, 'permission_denied');
  assert.equal(kube.context, 'eks-dev');
  assert.doesNotMatch(text(await mcp.callTool('check_profile', { provider: 'kubernetes', context: 'missing' })), /prod-cluster/);
  assert.equal(calls.find(call => call.url === '/api/architecture/kubernetes/check').body.context, 'eks-dev');
});

test('check_profile maps cloud permission errors without echoing provider responses', async () => {
  const { mcp } = await server({
    '/api/cloud/vercel/projects': async () => { throw new Error('KUA answered 403: private-token cannot access private project'); },
  });
  const result = JSON.parse(text(await mcp.callTool('check_profile', { provider: 'vercel', profile: 'web' })));
  assert.equal(result.status, 'permission_denied');
  assert.equal(result.code, 'PERMISSION_DENIED');
  assert.doesNotMatch(JSON.stringify(result), /private-token|private project/);
});

test('advisor tools explain the Pro plan when the report is locked', async () => {
  const { mcp } = await server({ '/api/cloud/aws/overview/advisor': { locked: true, required: 'pro', totals: { findings: 4, high: 1, medium: 2, low: 1 }, findings: [] } });
  const result = await mcp.callTool('aws_advisor', { profile: 'dev' });
  assert.equal(result.isError, true);
  assert.match(text(result), /part of the Pro plan\. This scan found 4 finding\(s\): 1 high, 2 medium, 1 low/);
});

// #133: profiles of the AWS/GCP CLIs on this computer, usable without adding them to KUA.
const LOCAL = {
  '/api/cloud/aws/local-profiles': [{ name: 'default', region: 'us-east-1', sso: false }, { name: 'staging', region: 'eu-west-1', sso: true }],
  '/api/cloud/gcp/gcloud-configs': [{ name: 'ncaicloud', project: 'ncaicloud', account: 'me@example.com', isActive: true }],
};

test('list_profiles adds the CLI profiles of this computer for a provider KUA has none of', async () => {
  const { createKuaMcp } = await load();
  const kua = fakeKua({ '/api/cloud/envs/profiles': [PROFILES[2]], ...LOCAL });
  const mcp = createKuaMcp({ request: kua.request });
  const profiles = JSON.parse(text(await mcp.callTool('list_profiles', {})));
  assert.deepEqual(profiles, [
    { id: 'p-gcp', name: 'analytics', provider: 'gcp' },
    { id: 'local:default', name: 'default', provider: 'aws', source: 'local', region: 'us-east-1' },
    { id: 'local:staging', name: 'staging', provider: 'aws', source: 'local', region: 'eu-west-1' },
  ]);
  // gcloud accounts are not shared.
  assert.doesNotMatch(text(await mcp.callTool('list_profiles', { provider: 'gcp' })), /me@example.com|ncaicloud/);
});

test('tools take a CLI profile by name, also next to KUA profiles', async () => {
  const { createKuaMcp } = await load();
  const kua = fakeKua({ '/api/cloud/envs/profiles': PROFILES, ...LOCAL, '/api/cloud/aws/overview/advisor': ADVISOR });
  const mcp = createKuaMcp({ request: kua.request });
  const result = await mcp.callTool('aws_advisor', { profile: 'staging', format: 'json' });
  assert.equal(result.isError, undefined);
  assert.equal(kua.calls.at(-1).headers['X-Profile-Id'], 'local:staging');

  const missing = await mcp.callTool('aws_advisor', { profile: 'qa' });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /No AWS profile "qa"\. In KUA: prod \(p-aws-1\), dev \(p-aws-2\)\. On this computer \(~\/\.aws\/config\): default \(local:default\), staging \(local:staging\)\./);
});

test('without KUA profiles, errors name the next step', async () => {
  const { createKuaMcp } = await load();
  const several = createKuaMcp({ request: fakeKua({ '/api/cloud/envs/profiles': [], ...LOCAL }).request });
  assert.match(text(await several.callTool('aws_advisor', {})), /KUA has no AWS profile, but this computer has 2 in ~\/\.aws\/config: pass "profile" with one of default, staging/);

  const single = fakeKua({ '/api/cloud/envs/profiles': [], ...LOCAL, '/api/cloud/gcp/overview': { advisor: ADVISOR } });
  await createKuaMcp({ request: single.request }).callTool('gcp_advisor', {});
  assert.equal(single.calls.at(-1).headers['X-Profile-Id'], 'local:ncaicloud');

  const none = createKuaMcp({ request: fakeKua({ '/api/cloud/envs/profiles': [], '/api/cloud/aws/local-profiles': [] }).request });
  assert.match(text(await none.callTool('aws_advisor', {})), /KUA has no AWS profile and none was found in ~\/\.aws\/config\. Add one in KUA with the key icon of the top bar \(Env Manager\)\./);
});

test('initialize tells the agent which KUA it reads, or that KUA is closed', async () => {
  const { createKuaMcp, connectionNote } = await load();
  const kua = { url: 'http://localhost:7192', version: '9.9.9', reachable: true, source: 'running' };
  const mcp = createKuaMcp({ request: async () => [], version: '9.9.9', locate: async () => kua });
  const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.match(init.result.instructions, /Connected to KUA 9\.9\.9 at http:\/\/localhost:7192\.$/);
  assert.deepEqual(init.result._meta, { kua });

  assert.match(connectionNote({ ...kua, version: '1.18.0' }, '1.17.0'), /This MCP server is 1\.17\.0: restart the agent session/);
  assert.match(connectionNote({ url: 'http://localhost:7190', reachable: false }, '1.17.0'), /KUA is not running at http:\/\/localhost:7190: ask the user to open KuaDashboard/);
  assert.equal(connectionNote(null, '1.17.0'), '');
});
