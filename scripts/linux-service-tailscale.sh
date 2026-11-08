#!/usr/bin/env bash
# Advanced (Linux): run Baton as a systemd user service AND expose it on your tailnet at https://<host>:8443,
# allowing only your own Tailscale login. The dashboard's "Get started" screen does the same in two clicks.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
NODE="$(command -v node)"
LOGIN="${BATON_ALLOWED_LOGINS:-$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["User"][str(d["Self"]["UserID"])]["LoginName"])' 2>/dev/null || true)}"

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/baton.service <<UNIT
[Unit]
Description=Baton - vibe coding session dashboard
After=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE --no-warnings server/index.js
Environment=PATH=$PATH
Environment=BATON_ALLOWED_LOGINS=$LOGIN
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now baton.service
# Wait for this installation, then use its actual selected port.
PORT="$(node --input-type=module <<'JS'
import { listenerConfig } from './server/listener.js';
for (let attempt = 0; attempt < 30; attempt++) {
  const config = listenerConfig(process.cwd(), process.platform, '');
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/instance`, { signal: AbortSignal.timeout(800) });
    if (response.ok && (await response.json()).id === config.id) {
      console.log(config.port);
      process.exit(0);
    }
  } catch { /* still starting */ }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error('Baton did not start. Check journalctl --user -u baton.service');
process.exit(1);
JS
)"
systemctl --user --no-pager status baton.service | head -5

# 테일넷 전용 (Funnel 아님). 기존 443 설정은 건드리지 않아요.
tailscale serve --bg --https=8443 "http://127.0.0.1:$PORT"
echo
echo "✅ 폰에서 열기: https://$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):8443"
echo "   (허용 로그인: ${LOGIN:-제한 없음})"
