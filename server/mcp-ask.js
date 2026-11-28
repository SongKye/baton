#!/usr/bin/env node
// Lightweight stdio MCP server exposing Baton's non-blocking `ask_user` tool.
// Spawned per-run by CLIs that support per-invocation MCP config (starting with Codex `-c mcp_servers.*`).
// Delivers structured questions out-of-band to Baton's localhost endpoint using a per-run bearer token,
// then immediately instructs the agent to end its turn so MCP tool timeouts never interrupt long user pauses.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ASK_USER_TOOL = {
  name: 'ask_user',
  description: 'Present structured multiple-choice questions to the user in Baton UI when you need their decision before proceeding. Non-blocking: after calling this tool, end your turn briefly and wait for the user to reply.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'options'],
          properties: {
            header: { type: 'string', description: 'Short topic label (<=16 chars)' },
            question: { type: 'string', description: 'Question to ask the user' },
            multiSelect: { type: 'boolean', description: 'Allow selecting multiple options' },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 6,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['label'],
                properties: {
                  label: { type: 'string', description: 'Concise choice label' },
                  description: { type: 'string', description: 'Optional brief explanation' },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Validate and normalize questions into the shape expected by Baton's askPager UI. */
export function normalizeAskQuestions(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = [];
  for (const item of raw.slice(0, 4)) {
    if (!item || typeof item !== 'object') return null;
    const question = String(item.question || '').trim().slice(0, 400);
    if (!question) return null;
    if (!Array.isArray(item.options)) return null;
    const options = [];
    for (const opt of item.options.slice(0, 6)) {
      if (typeof opt === 'string') {
        const label = opt.trim().slice(0, 120);
        if (label) options.push({ label, description: '' });
      } else if (opt && typeof opt === 'object') {
        const label = String(opt.label || '').trim().slice(0, 120);
        const description = String(opt.description || '').trim().slice(0, 240);
        if (label) options.push({ label, description });
      }
    }
    if (options.length < 2) return null;
    out.push({
      header: String(item.header || '').trim().slice(0, 32),
      question,
      multiSelect: Boolean(item.multiSelect),
      options,
    });
  }
  return out.length ? out : null;
}

const DEFAULT_PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'baton-ask', version: '1.0.0' };

let cachedFileConfig = null;
let readyNotified = false;

/**
 * Load per-run Baton callback credentials.
 * Prefers one-shot `BATON_ASK_FILE` (read into memory and immediately unlinked so grandchildren never inherit the token),
 * falling back to `BATON_ASK_URL` + `BATON_ASK_TOKEN` env vars (Codex `-c mcp_servers.*.env` & direct tests).
 */
function getAskConfig() {
  if (cachedFileConfig) return cachedFileConfig;
  const file = process.env.BATON_ASK_FILE;
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed?.url && parsed?.token) {
        cachedFileConfig = { url: String(parsed.url), token: String(parsed.token) };
      }
    } catch { /* missing or unreadable file */ }
    try { fs.unlinkSync(file); } catch { /* already removed */ }
    if (cachedFileConfig) return cachedFileConfig;
  }
  return {
    url: process.env.BATON_ASK_URL || '',
    token: process.env.BATON_ASK_TOKEN || '',
  };
}

/** Notify Baton once when the host CLI actually discovers `ask_user` (`tools/list`), enabling strict text fallback. */
async function notifyReady() {
  if (readyNotified) return;
  const { url, token } = getAskConfig();
  if (!url || !token) return;
  readyNotified = true;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ready: true }),
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* best-effort only */ }
}

async function handleToolCall(params) {
  const name = params?.name;
  if (name !== ASK_USER_TOOL.name) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${String(name || '')}` }] };
  }
  const questions = normalizeAskQuestions(params?.arguments?.questions);
  if (!questions) {
    return { isError: true, content: [{ type: 'text', text: 'Invalid arguments: provide 1-4 questions, each with a non-empty question and 2-6 options with labels.' }] };
  }
  const { url, token } = getAskConfig();
  if (!url || !token) {
    return { content: [{ type: 'text', text: 'Baton UI is not attached to this session. Ask the user directly in plain text instead.' }] };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ questions }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      let detail = String(res.status);
      try { const j = await res.json(); if (j?.error) detail = `${res.status}: ${j.error}`; } catch { /* ignore */ }
      return { isError: true, content: [{ type: 'text', text: `Baton UI rejected the questions (${detail}). Ask the user directly in plain text instead.` }] };
    }
    return {
      content: [{
        type: 'text',
        text: 'Questions have been displayed to the user in Baton UI. End your turn now briefly without repeating the options, and wait for their reply in the next message.',
      }],
    };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Could not reach Baton UI (${e.message}). Ask the user directly in plain text instead.` }] };
  }
}

export async function handleRpcMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const { id, method, params } = msg;
  // Notifications have no `id` and expect no response.
  if (id === undefined || id === null) return null;
  if (method === 'initialize') {
    const protocolVersion = typeof params?.protocolVersion === 'string' && params.protocolVersion ? params.protocolVersion : DEFAULT_PROTOCOL;
    return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    await notifyReady();
    return { jsonrpc: '2.0', id, result: { tools: [ASK_USER_TOOL] } };
  }
  if (method === 'tools/call') {
    const result = await handleToolCall(params);
    return { jsonrpc: '2.0', id, result };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(method || '')}` } };
}

function startStdio() {
  // Consume and unlink one-shot BATON_ASK_FILE immediately on boot before any user tool executes.
  getAskConfig();
  let buf = '';
  let useContentLength = false;
  const send = (obj) => {
    if (!obj) return;
    const json = JSON.stringify(obj);
    if (useContentLength) {
      process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
    } else {
      process.stdout.write(json + '\n');
    }
  };
  const dispatch = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    Promise.resolve(handleRpcMessage(msg))
      .then((res) => send(res))
      .catch((e) => {
        if (msg?.id !== undefined && msg?.id !== null) {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
        }
      });
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    for (;;) {
      const trimmed = buf.trimStart();
      if (/^content-length:/i.test(trimmed)) {
        useContentLength = true;
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const header = buf.slice(0, headerEnd);
        const m = header.match(/content-length:\s*(\d+)/i);
        if (!m) { buf = buf.slice(headerEnd + 4); continue; }
        const len = Number(m[1]);
        const rest = buf.slice(headerEnd + 4);
        if (Buffer.byteLength(rest, 'utf8') < len) break;
        const bytes = Buffer.from(rest, 'utf8');
        const body = bytes.subarray(0, len).toString('utf8');
        buf = bytes.subarray(len).toString('utf8');
        dispatch(body);
      } else {
        const nl = buf.indexOf('\n');
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) dispatch(line);
      }
    }
  });
  process.stdin.resume();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startStdio();
