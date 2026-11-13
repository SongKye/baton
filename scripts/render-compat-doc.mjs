// Keep the readable report available through Baton's existing static-file server.
// Run after editing docs/compatibility-checks.ko.md; no server restart is needed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markdown = await fs.readFile(path.join(root, 'docs/compatibility-checks.ko.md'), 'utf8');
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baton 호환성 검사 확장</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 22px;line-height:1.75;color:#20242b}
h1,h2,h3{line-height:1.35}h2{margin-top:2em}
table{border-collapse:collapse;width:100%;font-size:.93em}th,td{border:1px solid #d7dce1;padding:10px;vertical-align:top;overflow-wrap:anywhere}
th{background:#edf2f6;text-align:left}pre{background:#f2f4f7;padding:16px;overflow:auto}a{color:#165ec5}code{font-size:.94em}
@media(max-width:600px){body{padding:0 12px}th,td{padding:6px;font-size:.86em}}
</style></head><body>
${marked.parse(markdown)}
</body></html>\n`;
await fs.writeFile(path.join(root, 'public/compatibility-checks.html'), html);
console.log('Rendered /compatibility-checks.html');
