import { clip, oneLine, shortHome } from '../util.js';

/** One-line human summary of a tool call, used in collapsed tool rows. */
export function summarizeTool(name, input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { obj = null; }
  }
  if (obj && typeof obj === 'object') {
    const pick = obj.command ?? obj.cmd ?? obj.CommandLine ?? obj.file_path ?? obj.path ?? obj.Path ?? obj.AbsolutePath ?? obj.TargetFile ?? obj.Query ?? obj.Url
      ?? obj.pattern ?? obj.query ?? obj.url ?? obj.description ?? obj.toolSummary ?? obj.prompt;
    if (pick) return clip(oneLine(Array.isArray(pick) ? pick.join(' ') : shortHome(String(pick))), 160);
    return clip(oneLine(JSON.stringify(obj)), 160);
  }
  if (typeof input === 'string') {
    const m = input.match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return clip(oneLine(m[1].replace(/\\"/g, '"')), 160);
    return clip(oneLine(input), 160);
  }
  return '';
}

export function toolOutputText(out) {
  if (out == null) return '';
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) {
    return out.map((p) => (typeof p === 'string' ? p : p?.text ?? (p?.type === 'image' ? '[image]' : ''))).join('\n');
  }
  if (typeof out === 'object') return out.text ?? out.output ?? JSON.stringify(out);
  return String(out);
}

/** Collapse very long transcript arrays to the tail (UI can page back). */
export function pageMessages(msgs, before, limit = 80) {
  const end = before != null ? Math.max(0, Math.min(msgs.length, before)) : msgs.length;
  const start = Math.max(0, end - limit);
  return { messages: msgs.slice(start, end), start, total: msgs.length };
}

/** Trim heavy fields before sending to the browser. */
export function slimMessage(m) {
  if (m.tool) {
    return {
      ...m,
      tool: {
        ...m.tool,
        input: m.tool.input == null ? undefined : clip(typeof m.tool.input === 'string' ? m.tool.input : JSON.stringify(m.tool.input, null, 2), 4000),
        output: m.tool.output == null ? undefined : clip(m.tool.output, 4000),
      },
    };
  }
  if (m.text && m.text.length > 60000) return { ...m, text: clip(m.text, 60000) };
  return m;
}
