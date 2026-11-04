# Baton 🏃 — 바이브코딩 이어달리기 대시보드

Claude Code · Codex · Antigravity(agy) 세션을 한 화면에서 보고, 폰에서 바로 이어서 질문하는 모바일 PWA.

## 설치 / 실행
```bash
./scripts/install.sh      # systemd 사용자 서비스 + tailscale serve(테일넷 전용, :8443)
systemctl --user restart baton   # 코드 수정 후
journalctl --user -u baton -f    # 로그
```
폰(Safari)에서 `https://<머신>.ts.net:8443` → 공유 → 홈 화면에 추가 → 설정 탭에서 알림 켜기.

## 구조
- `server/sources/*` — 각 CLI 세션 파일 파서 (claude jsonl, codex rollout jsonl, agy sqlite+protobuf)
- `server/runner.js` — CLI 헤드리스 실행(`claude -p --resume`, `codex exec resume`, `agy -p --conversation`) + 스트림 정규화
- `server/brief.js` — 프로젝트 "어디까지 했더라" AI 브리핑
- `server/nudge.js` — 잠자는 프로젝트 하루 1회 푸시
- `public/` — 빌드 없는 바닐라 JS PWA
- `data/baton.db` — 고정/숨김/프로젝트 상태/브리핑/푸시 구독 (node:sqlite)

## 권한 모드
| Baton | Claude | Codex | Antigravity |
|---|---|---|---|
| 계획만 | `--permission-mode plan` | `sandbox_mode=read-only` | `--mode plan` |
| 자동 | `--permission-mode auto` | `sandbox_mode=workspace-write` | `--mode accept-edits` (명령은 거부됨) |
| 전체 허용 | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--dangerously-skip-permissions` |
