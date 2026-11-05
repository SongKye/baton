// Regression checks for directory browsing and default-folder settings.
// Run from the repository root: node scripts/folder-check.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('server/index.js', 'utf8');
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-browser-'));
let settings = { defaultCwd: '' };
const routes = new Map();
const ctx = vm.createContext({fs,fsp,path,HOME:home,tr:x=>x,shortHome:p=>p===home?'~':p.replace(home+path.sep,'~/'),store:{getSettings:()=>settings,updateSettings:p=>(settings={...settings,...p})},body:async r=>r,route:(m,p,f)=>routes.set(m+' '+p,f)});
vm.runInContext(source.slice(source.indexOf('function resolveCwd('),source.indexOf('const VERSION =')),ctx);
vm.runInContext(source.slice(source.indexOf("route('GET', '/api/dirs/browse'"),source.indexOf("route('GET', '/api/dirs',")),ctx);
vm.runInContext(source.slice(source.indexOf("route('POST', '/api/settings'"),source.indexOf("\n});",source.indexOf("route('POST', '/api/settings'"))+4),ctx);
const browse = p=>routes.get('GET /api/dirs/browse')({},new URL('http://test/?path='+encodeURIComponent(p)));
try {
  assert.equal(vm.runInContext('defaultCwd()',ctx),'~');
  await fsp.writeFile(path.join(home,'workspace'),'not a directory');
  assert.equal(vm.runInContext('defaultCwd()',ctx),'~');
  await fsp.unlink(path.join(home,'workspace'));
  await fsp.mkdir(path.join(home,'workspace'));
  await fsp.mkdir(path.join(home,'workspace','한글 space'));
  await fsp.mkdir(path.join(home,'.hidden'));
  await fsp.writeFile(path.join(home,'file.txt'),'file');
  await fsp.symlink(os.tmpdir(),path.join(home,'outside'));
  assert.equal(vm.runInContext('defaultCwd()',ctx),'~/workspace');
  let r=await browse('~'); assert.equal(r.parent,null);
  assert(r.items.some(x=>x.name==='.hidden' && x.hidden));
  assert(!r.items.some(x=>['file.txt','outside'].includes(x.name)));
  r=await browse('~/workspace'); assert.equal(r.parent,'~'); assert.equal(r.items[0].name,'한글 space');
  assert.equal((await browse('~/workspace/한글 space')).items.length,0);
  assert.equal((await browse('~/missing'))[0],400);
  assert.equal((await browse('~/missing'))[1].code,'ENOENT');
  assert.equal((await browse(home+'-sibling'))[0],400);
  assert.equal((await browse('~/outside'))[0],403);
  const save=routes.get('POST /api/settings');
  assert.equal((await save({defaultCwd:'~/workspace/한글 space'})).defaultCwd,'~/workspace/한글 space');
  assert.equal(vm.runInContext('defaultCwd()',ctx),'~/workspace/한글 space');
  for(const p of ['~/missing','~/file.txt','~/outside',123,null]) assert.equal((await save({defaultCwd:p}))[0],400);
  console.log('PASS: directory navigation, Unicode/spaces, hidden directories, file exclusion, missing paths, home boundary/symlink restrictions, automatic defaults, and settings validation');
} finally { await fsp.rm(home,{recursive:true,force:true}); }
