'use strict';
/**
 * lib/advisor/webhooks.js
 * Posture alerts (lib/advisor/posture.js) sent to Slack or Microsoft Teams
 * channels (Team plan), straight from this computer: no KUA server between.
 *
 * - The webhook URL is a secret (whoever has it can post in the channel): it
 *   is kept in the OS keychain (an encrypted file when there is none) and the
 *   API only ever returns it masked.
 * - Only Slack and Teams addresses over HTTPS are accepted, so the feature
 *   cannot be pointed at an arbitrary host.
 * - Alerts are grouped: the ones of a few seconds (one analysis) go in one
 *   message, at most 10 lines.
 * - Messages carry the rule, its severity and the place (cluster, region,
 *   project, application), never resource names or credentials.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const KINDS = {
  slack: host => host === 'hooks.slack.com',
  // Office 365 connectors and the Workflows (Power Automate) that replace them.
  teams: host => ['.webhook.office.com', '.logic.azure.com', '.powerplatform.com', '.powerautomate.com'].some(suffix => host.endsWith(suffix)),
};
const MIN_SEVERITIES = ['high', 'medium', 'all'];
const MAX_WEBHOOKS = 10;
const MAX_LINES = 10;
const ICONS = { new_finding: '🔴', fixed: '✅', acceptance_expiring: '⏳', acceptance_expired: '⚠️' };

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** Rejects anything but a Slack or Teams webhook over HTTPS. */
function validateUrl(kind, value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw badRequest('The webhook URL is not valid'); }
  if (url.protocol !== 'https:') throw badRequest('The webhook URL must use HTTPS');
  if (!KINDS[kind]) throw badRequest('kind must be slack or teams');
  if (!KINDS[kind](url.hostname.toLowerCase())) throw badRequest(kind === 'slack' ? 'A Slack webhook starts with https://hooks.slack.com/' : 'A Teams webhook is a Workflows or webhook.office.com address');
  return url.href;
}

/** https://hooks.slack.com/services/T…/…/abcd → https://hooks.slack.com/…abcd */
function maskUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}/…${value.slice(-4)}`;
  } catch { return '…'; }
}

/** Does this alert go to a webhook with that minimum severity? */
function matches(alert, minSeverity) {
  if (minSeverity === 'all') return true;
  if (alert.type === 'acceptance_expired') return true;
  if (minSeverity === 'high') return alert.severity === 'high';
  return alert.severity === 'high' || alert.severity === 'medium';
}

/** "Kubernetes · shop · all namespaces", without local profile ids when a name is known. */
function placeOf(alert) {
  const [provider, ...rest] = String(alert.scope || '').split(':');
  if (provider === 'product') return `KUApps · ${alert.data?.scopeLabel || rest.join(':')}`;
  const tail = rest.pop() || '';
  const head = rest.join(':');
  const profile = head.startsWith('local:') ? head.slice(6) : head;
  if (provider === 'aws') return `AWS · ${profile} · ${tail}`;
  if (provider === 'gcp') return `GCP · ${profile} · ${tail}`;
  if (provider === 'vercel') return `Vercel · ${profile} · ${tail}`;
  if (provider === 'kubernetes') return `Kubernetes · ${head.split('/').pop()} · ${tail === 'all' ? 'all namespaces' : tail}`;
  return alert.scope;
}

/** t() over the bundled locales (the MCP server's), from the unpacked copy in the installed app. */
async function loadTranslator(lang) {
  try {
    const dir = path.join(__dirname, '..', 'mcp').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const { translator } = await import(pathToFileURL(path.join(dir, 'kuaMcp.mjs')).href);
    return translator(lang);
  } catch {
    return key => key;
  }
}

function alertLine(alert, t) {
  const data = alert.data || {};
  const rule = t(`advisor.rule.${alert.ruleId}.title`, { count: data.count ?? '', ...(data.params || {}) });
  const date = data.expiresAt ? data.expiresAt.slice(0, 10) : '';
  return `${ICONS[alert.type] || '•'} ${t(`advisorAlerts.type.${alert.type}`, { rule, date })} — ${placeOf(alert)}`;
}

/** Body for the channel: Slack text, or a Teams adaptive card. */
function payload(kind, title, lines) {
  if (kind === 'slack') return { text: [`*${title}*`, ...lines].join('\n') };
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
        body: [{ type: 'TextBlock', text: title, weight: 'Bolder', wrap: true }, ...lines.map(text => ({ type: 'TextBlock', text, wrap: true, spacing: 'Small' }))],
      },
    }],
  };
}

/**
 * @param options.secrets { get, set }  where the webhooks (with their URLs) are kept
 * @param options.plan    () => plan; sending needs Team (teamSharing)
 */
function createWebhookDispatcher({ secrets, plan, fetchImpl = globalThis.fetch, translatorFor = loadTranslator, debounceMs = 3000, now = () => Date.now(), log = console } = {}) {
  const queue = [];
  let timer = null;

  function load() {
    try { return JSON.parse(secrets.get() || '[]'); } catch { return []; }
  }
  function save(list) { secrets.set(JSON.stringify(list)); }
  const view = ({ url, ...webhook }) => ({ ...webhook, url: maskUrl(url) });
  const requireTeam = () => {
    if (!plan().features.teamSharing) throw Object.assign(new Error('Alert webhooks are part of the Team plan'), { statusCode: 403, code: 'PLAN_REQUIRED', required: 'team' });
  };

  function normalize(input, current = {}) {
    const name = String(input.name ?? current.name ?? '').trim().slice(0, 80);
    if (!name) throw badRequest('A name is required');
    const minSeverity = input.minSeverity ?? current.minSeverity ?? 'high';
    if (!MIN_SEVERITIES.includes(minSeverity)) throw badRequest('minSeverity must be high, medium or all');
    const lang = (input.lang ?? current.lang ?? 'en') === 'es' ? 'es' : 'en';
    return { name, minSeverity, lang, enabled: input.enabled ?? current.enabled ?? true };
  }

  async function post(webhook, title, lines) {
    try {
      const response = await fetchImpl(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(webhook.kind, title, lines)),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`${webhook.kind === 'slack' ? 'Slack' : 'Teams'} answered ${response.status}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  function record(id, result) {
    const list = load();
    const webhook = list.find(item => item.id === id);
    if (!webhook) return;
    webhook.lastSentAt = new Date(now()).toISOString();
    webhook.lastError = result.ok ? null : result.error;
    save(list);
  }

  /** Sends the queued alerts, one message per webhook. */
  async function flush() {
    timer = null;
    const alerts = queue.splice(0);
    if (!alerts.length || !plan().features.teamSharing) return [];
    const sent = [];
    for (const webhook of load().filter(item => item.enabled)) {
      const mine = alerts.filter(alert => matches(alert, webhook.minSeverity));
      if (!mine.length) continue;
      const t = await translatorFor(webhook.lang);
      const lines = mine.slice(0, MAX_LINES).map(alert => alertLine(alert, t));
      if (mine.length > MAX_LINES) lines.push(t('advisorWebhooks.more', { n: mine.length - MAX_LINES }));
      const result = await post(webhook, t('advisorWebhooks.messageTitle'), lines);
      record(webhook.id, result);
      if (!result.ok) log.warn?.(`[advisor] webhook ${webhook.name}: ${result.error}`);
      sent.push({ id: webhook.id, ...result, lines: lines.length });
    }
    return sent;
  }

  return {
    /** Posture store hook: queues the alert; one analysis becomes one message. */
    notify(alert) {
      queue.push(alert);
      if (!timer) { timer = setTimeout(() => { flush().catch(() => {}); }, debounceMs); timer.unref?.(); }
    },
    flush,
    list: () => load().map(view),
    create(input) {
      requireTeam();
      const list = load();
      if (list.length >= MAX_WEBHOOKS) throw badRequest(`At most ${MAX_WEBHOOKS} webhooks`);
      const kind = input.kind;
      const webhook = { id: crypto.randomUUID(), kind, url: validateUrl(kind, input.url), ...normalize(input), createdAt: new Date(now()).toISOString(), lastSentAt: null, lastError: null };
      save([...list, webhook]);
      return view(webhook);
    },
    update(id, input) {
      requireTeam();
      const list = load();
      const index = list.findIndex(item => item.id === id);
      if (index < 0) return null;
      list[index] = { ...list[index], ...normalize(input, list[index]) };
      save(list);
      return view(list[index]);
    },
    remove(id) {
      const list = load();
      const next = list.filter(item => item.id !== id);
      if (next.length === list.length) return false;
      save(next);
      return true;
    },
    /** Sends a test message now; the result is also kept as the webhook's last status. */
    async test(id) {
      requireTeam();
      const webhook = load().find(item => item.id === id);
      if (!webhook) return null;
      const t = await translatorFor(webhook.lang);
      const result = await post(webhook, t('advisorWebhooks.messageTitle'), [t('advisorWebhooks.testLine')]);
      record(id, result);
      return result;
    },
  };
}

let shared = null;
function getWebhookDispatcher() {
  if (!shared) {
    const { createSecretStore, resolveDataDir } = require('../account/account');
    shared = createWebhookDispatcher({
      secrets: createSecretStore({ dataDir: resolveDataDir(), account: 'kua-advisor-webhooks', fileName: 'advisor-webhooks.enc' }),
      plan: () => require('../plans').getPlan(),
    });
  }
  return shared;
}

module.exports = { createWebhookDispatcher, getWebhookDispatcher, validateUrl, maskUrl, matches, placeOf, payload, alertLine, loadTranslator };
