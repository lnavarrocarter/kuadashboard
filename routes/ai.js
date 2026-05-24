'use strict';

/**
 * routes/ai.js
 * AI agent endpoints.
 *
 * Base path: /api/ai
 *
 * Providers:
 *   - ollama    → local runtime at http://127.0.0.1:11434 (OpenAI-compatible)
 *   - openai    → API key stored in Env Manager profile
 *   - anthropic → API key stored in Env Manager profile
 */

const express = require('express');
const { getStore } = require('../lib/credentialStore');
const { listAgents, buildSystemPrompt } = require('../lib/aiAgents');

const router = express.Router();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODELS = {
  ollama: 'llama3.1:8b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
};

function handleErr(res, err) {
  console.error('[ai]', err);
  if (res.headersSent) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
    return;
  }
  res.status(500).json({ error: err.message });
}

function getProvider(req) {
  return String(req.get('X-AI-Provider') || req.body?.provider || 'ollama').toLowerCase();
}

function getModel(req, provider) {
  return String(req.get('X-AI-Model') || req.body?.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.ollama);
}

async function getProfileKeys(req) {
  const profileId = req.get('X-Profile-Id') || req.body?.profileId;
  if (!profileId) return {};
  return getStore().getRawKeys(profileId);
}

function normalizeMessages(messages = []) {
  return messages
    .filter(m => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
    .map(m => ({ role: m.role, content: m.content }));
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function setSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function streamOpenAiCompatible({ baseUrl, apiKey, model, system, messages, res }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${errorText.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        writeSse(res, 'done', {});
        return;
      }
      if (!payload) continue;

      const data = JSON.parse(payload);
      const delta = data.choices?.[0]?.delta?.content || '';
      if (delta) writeSse(res, 'chunk', { delta });
    }
  }

  writeSse(res, 'done', {});
}

async function streamAnthropic({ apiKey, baseUrl, model, system, messages, res }) {
  if (!apiKey) throw new Error('Missing Anthropic API key');

  const response = await fetch(`${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system,
      stream: true,
      max_tokens: 4096,
      messages: messages.filter(m => m.role !== 'system'),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${errorText.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      const data = JSON.parse(payload);
      if (data.type === 'content_block_delta' && data.delta?.text) {
        writeSse(res, 'chunk', { delta: data.delta.text });
      }
      if (data.type === 'message_stop') {
        writeSse(res, 'done', {});
        return;
      }
    }
  }

  writeSse(res, 'done', {});
}

router.get('/agents', (_req, res) => {
  res.json({ agents: listAgents() });
});

// Static fallback models per provider (used when API is unavailable or no key configured)
const STATIC_MODELS = {
  ollama: [
    { name: 'llama3.1:8b' },
    { name: 'llama3.2:3b' },
    { name: 'mistral:7b' },
    { name: 'phi4:14b' },
    { name: 'gemma3:12b' },
    { name: 'qwen2.5:7b' },
    { name: 'deepseek-r1:8b' },
  ],
  openai: [
    { name: 'gpt-4o' },
    { name: 'gpt-4o-mini' },
    { name: 'gpt-4-turbo' },
    { name: 'gpt-4' },
    { name: 'o1' },
    { name: 'o1-mini' },
    { name: 'o3-mini' },
  ],
  anthropic: [
    { name: 'claude-opus-4-5' },
    { name: 'claude-sonnet-4-5' },
    { name: 'claude-haiku-4-5' },
    { name: 'claude-3-5-sonnet-latest' },
    { name: 'claude-3-5-haiku-latest' },
    { name: 'claude-3-opus-latest' },
  ],
};

router.get('/status', async (_req, res) => {
  try {
    const version = await fetchJson(`${OLLAMA_BASE_URL}/api/version`);
    res.json({ ollama: { running: true, baseUrl: OLLAMA_BASE_URL, version: version?.version || null } });
  } catch (err) {
    res.json({ ollama: { running: false, baseUrl: OLLAMA_BASE_URL, error: err.message } });
  }
});

/**
 * GET /api/ai/models?provider=ollama|openai|anthropic&profileId=<id>
 *
 * Returns the list of available models for the given provider.
 * - ollama    → live list from local Ollama instance (/api/tags)
 * - openai    → live list from OpenAI /v1/models filtered to GPT/O-series (needs API key)
 * - anthropic → live list from Anthropic /v1/models (needs API key)
 *
 * Falls back to static model list when service is unavailable or no key provided.
 */
router.get('/models', async (req, res) => {
  const provider = String(req.query.provider || 'ollama').toLowerCase();
  const profileId = req.query.profileId;

  try {
    if (provider === 'ollama') {
      const data = await fetchJson(`${OLLAMA_BASE_URL}/api/tags`);
      const models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      }));
      return res.json({ models: models.length ? models : STATIC_MODELS.ollama });
    }

    // For cloud providers, try to fetch API key from profile
    let apiKey = null;
    let baseUrl = null;
    if (profileId) {
      const keys = await getStore().getRawKeys(profileId).catch(() => ({}));
      apiKey = provider === 'openai'
        ? (keys.OPENAI_API_KEY || keys.API_KEY)
        : (keys.ANTHROPIC_API_KEY || keys.API_KEY);
      baseUrl = keys.BASE_URL || null;
    }

    if (provider === 'openai') {
      if (!apiKey) return res.json({ models: STATIC_MODELS.openai, static: true });
      const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`;
      const data = await fetchJson(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      const GPT_PATTERN = /^(gpt-|o\d)/i;
      const models = (data.data || [])
        .filter(m => GPT_PATTERN.test(m.id))
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .map(m => ({ name: m.id }));
      return res.json({ models: models.length ? models : STATIC_MODELS.openai });
    }

    if (provider === 'anthropic') {
      if (!apiKey) return res.json({ models: STATIC_MODELS.anthropic, static: true });
      const url = `${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`;
      const data = await fetchJson(url, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      const models = (data.data || []).map(m => ({ name: m.id }));
      return res.json({ models: models.length ? models : STATIC_MODELS.anthropic });
    }

    res.status(400).json({ error: `Unknown provider: ${provider}` });
  } catch (err) {
    const fallback = STATIC_MODELS[provider] || [];
    res.json({ models: fallback, error: err.message, static: true });
  }
});

router.post('/models/pull', async (req, res) => {
  try {
    const model = String(req.body?.model || '').trim();
    if (!model) return res.status(400).json({ error: '`model` is required' });
    const data = await fetchJson(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
    });
    res.json({ ok: true, model, data });
  } catch (err) { handleErr(res, err); }
});

router.post('/chat', async (req, res) => {
  setSseHeaders(res);
  try {
    const provider = getProvider(req);
    const model = getModel(req, provider);
    const messages = normalizeMessages(req.body?.messages);
    const context = req.body?.context || {};
    const agentId = req.body?.agent || 'general';
    const system = buildSystemPrompt(agentId, context);
    const keys = await getProfileKeys(req);

    writeSse(res, 'meta', { provider, model, agent: agentId });

    if (provider === 'anthropic') {
      await streamAnthropic({
        apiKey: keys.ANTHROPIC_API_KEY || keys.API_KEY,
        baseUrl: keys.BASE_URL,
        model,
        system,
        messages,
        res,
      });
    } else {
      const baseUrl = provider === 'openai'
        ? (keys.BASE_URL || 'https://api.openai.com/v1')
        : `${OLLAMA_BASE_URL}/v1`;
      await streamOpenAiCompatible({
        baseUrl,
        apiKey: provider === 'openai' ? (keys.OPENAI_API_KEY || keys.API_KEY) : 'ollama',
        model,
        system,
        messages,
        res,
      });
    }
  } catch (err) { handleErr(res, err); }
});

module.exports = router;
