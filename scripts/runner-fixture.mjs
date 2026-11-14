// Local CLI double used only by runner-check.mjs. No network or model calls.
import readline from 'node:readline';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [tool, ...args] = process.argv.slice(2);
const emit = (e, newline = true) => process.stdout.write(JSON.stringify(e) + (newline ? '\n' : ''));
const sid = tool + '-test';
let scenario, lines;
const init = () => emit(tool === 'claude' ? { type: 'system', subtype: 'init', session_id: sid }
  : tool === 'codex' ? { type: 'thread.started', thread_id: sid }
    : tool === 'agy' ? { event: 'init', conversation_id: sid } : { type: 'start', sessionID: sid });
const text = (value) => emit(tool === 'claude' ? { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: value } } }
  : tool === 'codex' ? { type: 'item.completed', item: { type: 'agent_message', text: value } }
    : tool === 'agy' ? { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: value, state: 'DONE' } }
      : { type: 'text', sessionID: sid, part: { text: value } });
function done(ok = true, newline = true) {
  const e = tool === 'claude' ? { type: 'result', session_id: sid, is_error: !ok, result: ok ? 'OK' : 'rate limit exceeded', usage: { input_tokens: 1, output_tokens: 2 } }
    : tool === 'codex' ? { type: ok ? 'turn.completed' : 'turn.failed', usage: { input_tokens: 1, output_tokens: 2 }, error: { message: 'rate limit exceeded' } }
      : tool === 'agy' ? { event: 'result', result: { status: ok ? 'SUCCESS' : 'ERROR', response: 'OK', error: ok ? null : 'rate limit exceeded' } }
        : ok ? { type: 'step_finish', part: { tokens: { input: 1, output: 2 } } } : { type: 'error', error: { message: 'rate limit exceeded' } };
  emit(e, newline);
  lines?.close();
  process.stdin.destroy();
  if (scenario?.name === 'nonzero') process.exitCode = 3;
}
function tools() {
  if (tool === 'claude') {
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'fixture.txt' } }] } });
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'read', is_error: false }] } });
  } else if (tool === 'codex') {
    emit({ type: 'item.started', item: { type: 'command_execution', command: 'echo OK' } });
    emit({ type: 'item.completed', item: { type: 'command_execution', exit_code: 0 } });
  } else if (tool === 'agy') {
    emit({ event: 'step_update', step_update: { step_type: 'tool', step_index: 1, tool_name: 'read_file', state: 'RUNNING' } });
    emit({ event: 'step_update', step_update: { step_type: 'tool', step_index: 1, tool_name: 'read_file', state: 'DONE' } });
  } else emit({ type: 'tool_use', part: { tool: 'read', state: { status: 'completed' } } });
}
function run(input) {
  scenario = JSON.parse(input);
  if (scenario.argsFile) fs.writeFileSync(scenario.argsFile, JSON.stringify(args));
  if (scenario.cwdFile) fs.writeFileSync(scenario.cwdFile, JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD }));
  init();
  if (scenario.name === 'delayed-tool') {
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'slow-tool', name: 'Bash', input: { command: 'fixture' } }] } });
    const timer = setInterval(() => {
      if (!fs.existsSync(scenario.releaseFile)) return;
      clearInterval(timer);
      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'slow-tool', content: 'failed', is_error: true }] } });
      done();
    }, 20);
    return;
  }
  if (scenario.name === 'ask' || scenario.name === 'deny') {
    emit({ type: 'control_request', request_id: 'question-1', request: { subtype: 'can_use_tool', tool_name: scenario.name === 'ask' ? 'AskUserQuestion' : 'Bash', input: { questions: [{ question: 'Pick?', header: 'Pick', options: [{ label: 'Yes' }, { label: 'No' }] }] } } });
    return;
  }
  if (scenario.name === 'hang') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    fs.writeFileSync(scenario.pidFile, String(child.pid));
    text('waiting');
    setInterval(() => {}, 1000);
    return;
  }
  if (scenario.name === 'tools') tools();
  if (scenario.name === 'sandboxed' && tool === 'codex') {
    // what Codex's workspace sandbox looks like: an ordinary failed command, never a denial event
    emit({ type: 'item.started', item: { type: 'command_execution', command: "/bin/bash -lc 'git commit -qm x'" } });
    emit({ type: 'item.completed', item: { type: 'command_execution', command: "/bin/bash -lc 'git commit -qm x'", exit_code: 128, aggregated_output: "fatal: Unable to create '/p/.git/index.lock': Read-only file system" } });
    emit({ type: 'item.completed', item: { type: 'command_execution', command: "/bin/bash -lc 'npm test'", exit_code: 1, aggregated_output: '1 failing' } });
  }
  if (scenario.name === 'slow') {
    text('first');
    const timer = setInterval(() => {
      if (!fs.existsSync(scenario.releaseFile)) return;
      clearInterval(timer); text('second'); done();
    }, 20);
    return;
  }
  if (scenario.name === 'many') { for (let i = 0; i < 21000; i++) text('x'); }
  else text('한글 😀 OK');
  if (scenario.name === 'incomplete') { lines?.close(); process.stdin.destroy(); return; }
  done(scenario.name !== 'error', scenario.name !== 'no-newline');
}
if (tool === 'claude' && args.includes('--input-format')) {
  lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const e = JSON.parse(line);
    if (e.type === 'user') run(e.message.content[0].text);
    if (e.type === 'control_response') { text(JSON.stringify(e.response)); done(); }
  });
} else if (tool === 'agy') {
  run(args.find((a) => a.startsWith('-p='))?.slice(3) || args[args.indexOf('-p') + 1]);
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (tool === 'claude') { const s = JSON.parse(input); if (s.argsFile) fs.writeFileSync(s.argsFile, JSON.stringify(args)); if (s.cwdFile) fs.writeFileSync(s.cwdFile, JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD })); emit({ result: 'OK', is_error: s.name === 'error' }); }
  else run(input);
}
