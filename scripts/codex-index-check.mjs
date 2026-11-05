// Regression: a large image places the user event between both index windows.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {headJsonl,tailJsonl,eachJsonl,cleanPrompt,clip,oneLine} from '../server/util.js';
const source = await fs.readFile('server/sources/codex.js','utf8');
const ctx = vm.createContext({headJsonl,tailJsonl,eachJsonl,cleanPrompt,clip,oneLine});
vm.runInContext(source.slice(source.indexOf('function userText('),source.indexOf('export async function listCodex')),ctx);
const dir = await fs.mkdtemp(path.join(os.tmpdir(),'baton-codex-index-'));
const file = path.join(dir,'rollout.jsonl');
const event = (type,payload)=>JSON.stringify({type,payload,timestamp:'2026-11-05T04:00:00Z'})+'\n';
const meta = event('session_meta',{id:'image-session',cwd:'/project',source:'exec'});
const padding = event('response_item',{type:'message',role:'developer',content:[{text:'x'.repeat(250000)}]});
const prompt = event('event_msg',{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text:'Find my session'}]}});
try {
  for (const content of [meta+prompt,meta+padding+prompt,meta+padding+prompt+padding]) {
    await fs.writeFile(file,content);
    const s = await ctx.summarize(file,await fs.stat(file),new Set(['image-session']));
    assert.equal(s.firstPrompt,'Find my session');
    assert.equal(s.automated,false);
  }
  await fs.writeFile(file,meta+padding);
  assert.equal(await ctx.summarize(file,await fs.stat(file),new Set()),null);
  console.log('PASS: short, image-heavy, grown transcripts retain their session; empty sessions excluded');
} finally { await fs.rm(dir,{recursive:true,force:true}); }
