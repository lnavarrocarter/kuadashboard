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
  const request = async (url, { headers = {} } = {}) => {
    calls.push({ url, headers });
    const pathname = url.split('?')[0];
    if (!(pathname in routes)) throw new Error(`unexpected ${url}`);
    const value = routes[pathname];
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
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
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

test('gcp_advisor uses the single GCP profile and the overview advisor', async () => {
  const { mcp, calls } = await server({ '/api/cloud/gcp/overview': { advisor: { ...ADVISOR, scope: { provider: 'gcp', projectId: 'acme' }, findings: [] } } });
  const md = text(await mcp.callTool('gcp_advisor', {}));
  assert.match(md, /- \*\*Project:\*\* `acme`/);
  assert.match(md, /Every check passes/);
  assert.equal(calls.at(-1).headers['X-Profile-Id'], 'p-gcp');
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
  const { mcp, calls } = await server({
    '/api/architecture/applications/catalog': catalog,
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

test('httpRequest explains when KUA is not running and relays KUA errors', async () => {
  const { httpRequest } = await load();
  const down = httpRequest('http://127.0.0.1:1', { fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  await assert.rejects(down('/api/x'), /KUA is not reachable at http:\/\/127.0.0.1:1 \(ECONNREFUSED\)/);

  const failing = httpRequest('http://kua', { fetchImpl: async () => new Response(JSON.stringify({ error: 'Log group is not cached' }), { status: 404 }) });
  await assert.rejects(failing('/api/x'), /KUA answered 404: Log group is not cached/);
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
