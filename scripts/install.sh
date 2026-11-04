#!/usr/bin/env bash
# Baton 설치: systemd 사용자 서비스 등록 + Tailscale(테일넷 전용) HTTPS 8443 노출
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
Environment=BATON_PORT=7420
Environment=BATON_ALLOWED_LOGINS=$LOGIN
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now baton.service
sleep 3
systemctl --user --no-pager status baton.service | head -5

# 테일넷 전용 (Funnel 아님). 기존 443 설정은 건드리지 않아요.
tailscale serve --bg --https=8443 http://127.0.0.1:7420
echo
echo "✅ 폰에서 열기: https://$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):8443"
echo "   (허용 로그인: ${LOGIN:-제한 없음})"
