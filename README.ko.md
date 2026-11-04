# Baton 🏃

**AI 코딩 세션을 한곳에서** — Claude Code, Codex, Antigravity, OpenCode, Cursor.
모든 세션을 제목과 함께 보고, PC든 폰이든 바로 이어서 대화하고, 잊혀가는 프로젝트를 다시 챙겨줘요.

[English README](README.md)

- **모든 세션 한눈에** — 제목·미리보기·검색·고정·숨김, 터미널에서 돌고 있는 세션까지 실시간 표시
- **어떤 세션이든 이어서** — 채팅 화면, 실시간 답변, 도구 실행 내역, 사진 첨부, 메시지마다 모델·노력·권한 선택
- **"어디까지 했더라?" 브리핑** — 프로젝트별 AI 요약(한 일, 다음 할 일, 바로 보낼 요청문)과 잊힌 프로젝트 하루 한 번 알림
- **사용량·한도** — Claude·Codex·Antigravity 구독 한도 실시간, CLI·모델별 토큰 사용량
- **서빙 중인 포트** — 어떤 개발 서버가 어느 프로젝트·어느 AI 세션에서 떴는지, 폰에서 열기
- **스킬** — CLI마다 어떤 스킬이 어디 있고 실제로 언제 쓰였는지
- **정리** — 테스트·자동 실행·"hi" 세션을 한 번에 휴지통으로 (30일 안에 되살리기)
- **알림** — 답변이 끝나면 폰으로 푸시 (터미널에서 돌리는 세션도)
- **CLI 간 이어받기** — 한 도구의 토큰이 부족하면 다른 도구가 정리 노트를 읽고 같은 세션을 이어서 진행 (다시 돌려받기도 가능). 여러 구독의 한도를 나눠 쓸 수 있어요
- **기기 기억 + 비밀번호** — 이 PC는 항상 허용, 다른 기기는 처음 한 번 비밀번호 입력 (기본 `0000`, 설정 → 보안에서 변경) 후 30일 동안 기억
- **English / 한국어**, 라이트/다크, 모바일·데스크톱 레이아웃

## 빠른 시작

**Node.js 22.13 이상**이 필요해요 (설치 스크립트가 대신 설치해줄 수 있어요).

**macOS · Linux · WSL**

```bash
git clone https://github.com/SongKye/baton.git
cd baton
./scripts/setup.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/SongKye/baton.git
cd baton
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

브라우저에서 **http://localhost:7420** 이 열리고 **시작하기** 화면이 안내해요.

1. 내 컴퓨터 점검 (OS, Node.js, Git — Windows/macOS는 Git 설치까지)
2. 5가지 AI 코딩 CLI를 버튼 한 번으로 설치 (각 회사 공식 설치 방법 사용)
3. 로그인 (로그인 페이지 열기, 기기 코드 표시, 코드 붙여넣기 — 터미널 없이)
4. (선택) Tailscale로 폰에서 접속
5. (선택) 컴퓨터를 켜면 Baton 자동 실행 (Linux/WSL systemd, macOS launchd, Windows 시작프로그램)

CLI를 설치하면 기존 세션이 바로 Baton에 나타나요. 따로 연동할 건 없어요.

다음부터는 `npm start` (브라우저까지 열려면 `npm run open`).

언어는 기본 영어이고, **설정 → Language · 언어**에서 한국어로 바꿀 수 있어요.

## 지원 현황

| CLI | 세션 보기 | 이어서/새 세션 | 사진 | 실시간 한도 | 토큰 사용량 | 설치 지원 |
|---|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | ✅ | ✅ | macOS, Linux, WSL, Windows |
| Codex | ✅ | ✅ | ✅ | ✅ | ✅ | macOS, Linux, WSL, Windows (npm) |
| Antigravity (`agy`) | ✅ | ✅ | ✅ (작업 폴더 파일로) | ✅ | ✅ | macOS, Linux, WSL |
| OpenCode | ✅ 베타 | ✅ 베타 | ✅ | — | ✅ | macOS, Linux, WSL, Windows (npm) |
| Cursor (`cursor-agent`) | ✅ 베타 | ✅ 베타 | ✅ (작업 폴더 파일로) | — | — | macOS, Linux, WSL, Windows |

*베타*: 공개된 형식 기준으로 구현했고 실제 설치 환경에서는 아직 검증 전이에요.

## 폰에서 쓰기

Baton은 `127.0.0.1`에서만 열려요. 폰에서 쓰려면 PC와 폰에 [Tailscale](https://tailscale.com/download)을 설치하고 시작하기 화면에서 **내 기기에 공유**를 누르세요. (`tailscale serve --https=8443` — 내 테일넷 안에서만 보이고 인터넷에 공개되지 않아요.) 폰에서 `https://<PC이름>.<tailnet>.ts.net:8443`을 열고 홈 화면에 추가한 뒤 설정에서 알림을 켜면 돼요.

## 문제 해결

- **설치했는데 "설치 안 됨"으로 보여요** — 시작하기에서 ↻. Windows는 Baton을 다시 실행해야 새 PATH가 반영돼요.
- **포트 7420이 이미 사용 중** — `BATON_PORT=7421 npm start`
- **Windows**: Codex·Antigravity는 WSL에서 가장 잘 동작해요. WSL 안에서 `./scripts/setup.sh`를 실행하고 Windows 브라우저에서 `http://localhost:7420`을 여세요.
- 번역 누락 확인: `npm run i18n:check`
