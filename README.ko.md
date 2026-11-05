<div align="center">

# 🏃 Baton

**AI 코딩 세션을 한곳에서.**
Claude Code · Codex · Antigravity · OpenCode · Cursor — PC에서도, 폰에서도.

[![CI](https://github.com/SongKye/baton/actions/workflows/ci.yml/badge.svg)](https://github.com/SongKye/baton/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SongKye/baton?include_prereleases)](https://github.com/SongKye/baton/releases)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933)
![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows%20%7C%20WSL-555)
![License](https://img.shields.io/badge/license-MIT-blue)

[English](README.md) · 한국어

</div>

---

바이브코딩을 하다 보면 여러 프로젝트를 여러 AI 도구로 동시에 굴리게 되고, 어디까지 했는지 자주 잊어버려요.
Baton은 각 CLI가 이미 남기고 있는 세션 기록을 모아서 한 화면에 보여주고, 브라우저나 폰에서 바로 이어서 대화하게 해줘요.

- 🗂 **모든 세션을 한 목록에** — 제목·미리보기·검색·고정, 지금 돌고 있는 세션 표시 (터미널에서 돌아도)
- 💬 **어디서든 이어서** — 실시간 답변, 도구 실행 내역, 사진 첨부, 메시지마다 모델·노력·권한 선택, AI의 질문엔 눌러서 바로 답하기
- 🧭 **"어디까지 했더라?"** — 프로젝트별 AI 브리핑(한 일, 다음 할 일, 바로 보낼 요청문)과 잊힌 프로젝트 알림
- 🔀 **한도 나눠 쓰기** — 같은 프로젝트에서 다른 CLI로 새 세션, 또는 토큰이 부족할 때 세션 넘기기
- 📊 **한도·사용량** — 구독 한도 실시간, CLI·모델별 토큰 사용량
- 🔌 **MCP 서버** — 자주 쓰는 서버를 모든 CLI에 한 번에 추가하고, 폴더마다 각 CLI가 뭘 불러오는지·연결은 되는지·실제로 어떤 도구를 호출했는지 확인
- 🖥 **서빙 중인 포트 · 🧩 스킬 · 🧹 정리** — 어디서 뭐가 떠 있는지, 실제로 쓰인 스킬, 쓸모없는 세션 한 번에 정리
- 🔔 **알림** — 답변이 끝나거나 AI가 질문하면 폰으로, 데스크톱에선 화면 구석에 알림 카드로
- 🏢 **어떤 방식이든** — 구독, API 키, Amazon Bedrock, Google Vertex, LLM 게이트웨이, 직접 서빙하는 모델

## 빠른 시작

**Node.js 22.13 이상**이 필요해요 (설치 스크립트가 대신 설치해줄 수 있어요).

<table>
<tr><th>macOS · Linux · WSL</th><th>Windows (PowerShell)</th></tr>
<tr><td>

```bash
git clone https://github.com/SongKye/baton.git
cd baton
./scripts/setup.sh
```

</td><td>

```powershell
git clone https://github.com/SongKye/baton.git
cd baton
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

</td></tr>
</table>

Git이 없으면 [Releases](https://github.com/SongKye/baton/releases)에서 zip을 받아 풀고 같은 스크립트를 실행하세요.

**http://localhost:7420** 이 열리고 **시작하기** 화면이 순서대로 안내해요.

1. **컴퓨터 준비** — OS, Node.js, Git (Windows·macOS는 Git 원클릭 설치)
2. **AI 연결** — AI를 쓰는 방법을 고르세요
   - *구독 계정* — 각 회사 공식 설치 방법으로 원클릭 설치, 로그인도 화면 안에서 (로그인 링크·기기 코드·코드 붙여넣기)
   - *API 키* — 붙여넣으면 Anthropic·OpenAI·OpenRouter·Groq 키를 알아보고 맞는 CLI에 연결해요
   - *회사 계정* — Bedrock, Vertex, Azure OpenAI, 사내 게이트웨이
   - *내 컴퓨터·서버의 모델* — Ollama·LM Studio·vLLM·LiteLLM·llama.cpp·Jan을 자동으로 찾아요
3. **도구 붙이기 (MCP)** (선택) — 눌러서 모든 CLI에 한 번에 추가
4. **폰 연결** (선택) — Tailscale을 단계별로 따라 하고 QR 코드를 찍으면 끝
5. **자동 시작** (선택) — systemd / launchd / Windows 시작프로그램

단계마다 끝났는지 표시되고, 연결은 **연결 테스트**로 확인할 수 있어요.

CLI를 설치하면 기존 세션이 바로 나타나요. 다음부터는 `npm start` (브라우저까지 열려면 `npm run open`).

## 지원 현황

| | 세션 보기 | 대화·새 세션 | 사진 | 실시간 한도 | 토큰 사용량 | 연결 방식 |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | ✅ | 구독 · API 키 · Bedrock · Vertex · 게이트웨이/내 서버 |
| **Codex** | ✅ | ✅ | ✅ | ✅ | ✅ | ChatGPT · API 키 · Azure OpenAI · 게이트웨이/내 서버 |
| **Antigravity** | ✅ | ✅ | ✅ | ✅ | ✅ | Google 계정 |
| **OpenCode** | 베타 | 베타 | ✅ | — | ✅ | 무료 모델 · OpenAI 호환 서버 |
| **Cursor** | 베타 | 베타 | ✅ | — | — | Cursor 계정 |

*베타* — 공개된 형식대로 구현했고, 실제 설치 환경에서는 아직 검증 전이에요.

## 내 모델 연결하기

구독이 없어도 돼요. **시작하기 → AI 연결**에서 *API 키*, *회사 계정*, *내 컴퓨터·서버의 모델* 중에 고르세요:

| 가진 것 | 고를 곳 | Baton이 저장하는 것 |
|---|---|---|
| Anthropic API 키 | Claude Code → *Anthropic API 키* | `~/.claude/settings.json` (`env`) |
| AWS Bedrock 권한 | Claude Code → *Amazon Bedrock* | `CLAUDE_CODE_USE_BEDROCK`, 리전, 프로필, 모델 |
| GCP Vertex 권한 | Claude Code → *Google Vertex AI* | `CLAUDE_CODE_USE_VERTEX`, 프로젝트, 리전, 모델 |
| **Anthropic Messages API**를 지원하는 게이트웨이·자체 서빙 (예: LiteLLM) | Claude Code → *LLM 게이트웨이 · 내 서버* | `ANTHROPIC_BASE_URL`, 토큰, 모델 |
| OpenAI API 키 | Codex → *OpenAI API 키* | `codex login --with-api-key` |
| **OpenAI Responses API**를 지원하는 Azure OpenAI·게이트웨이·서버 | Codex → *내 서버* | `~/.codex/config.toml` 공급자 |
| Ollama·vLLM·LM Studio 등 (**chat completions**만 지원) | OpenCode → *OpenAI 호환 서버* | `opencode.json` 공급자 |

저장할 때는 기존 파일을 먼저 백업하고, 터미널에서도 똑같이 동작해요. 서버 주소를 넣는 칸은 그 서버의 모델 목록(`/v1/models`)을 불러와서 이름을 직접 칠 필요가 없어요. 연결하면 한 줄짜리 요청을 보내 바로 테스트해요.

> Codex는 Responses API만 지원해요 (`wire_api = "chat"`은 없어졌어요). chat만 되는 서버는 OpenCode로 쓰거나, 앞에 LiteLLM 같은 프록시를 두세요.

### 회사 PC에서

- **터미널 환경을 그대로 써요.** 시작할 때 로그인 셸(`~/.bashrc`, `~/.zshrc`)을 읽어서 모든 CLI에 넘겨요. 백그라운드 서비스로 돌아도 `AWS_PROFILE`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS` 같은 설정이 적용돼요. 그 밖의 값은 **설정 → 회사 환경 · CLI 환경 변수**에 넣으면 돼요.
- 설정 폴더를 옮겨둔 경우(`CLAUDE_CONFIG_DIR`, `CODEX_HOME`)도 따라가요.
- Bedrock·API·게이트웨이는 한도 화면에 "구독 한도 없음"으로 나오고, 모델 선택은 그 방식이 이해하는 이름만 보여주며, 어디서든 모델 ID를 직접 입력할 수 있어요.

## MCP 서버

### 눌러서 추가하기

**시작하기 → 도구 붙이기** 또는 **도구 → MCP 서버**의 **＋**에서 서버와 추가할 CLI를 고르세요.
Context7, Playwright, Chrome DevTools, GitHub, Filesystem, Memory, Sequential Thinking, Fetch, Notion, Linear, Sentry, Supabase, Figma — 또는 직접 실행 명령·URL을 넣어도 돼요.
각 CLI의 전역 설정(`claude mcp add-json -s user`, `~/.codex/config.toml`, `mcp_config.json`, `opencode.json`, `~/.cursor/mcp.json`)에 쓰고, 바꾸기 전 파일은 `.baton-backup`으로 남겨요.
서버 화면의 **다른 CLI에도 추가**는 설정을 그대로 복사하고(키 포함 — 내 컴퓨터 밖으로 나가지 않아요), **삭제**는 지워요.

### 뭘 불러오고 실제로 썼는지 보기

**도구 → MCP 서버**에서 CLI가 볼 수 있는 MCP 서버를 설정된 위치별로 모아 보여줘요.

| CLI | 전역 | 프로젝트별 |
|---|---|---|
| Claude Code | `~/.claude.json` (user), 플러그인, `managed-mcp.json`, claude.ai 커넥터 | `.mcp.json` (공유, 승인 필요) · `~/.claude.json` → `projects` (local, 나만) |
| Codex | `~/.codex/config.toml` `[mcp_servers.*]` | `.codex/config.toml` |
| Antigravity | `~/.gemini/config/mcp_config.json`, 플러그인 | `.agents/plugins/*/mcp_config.json` |
| OpenCode | `~/.config/opencode/opencode.json` `mcp` | `opencode.json` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |

- **이 폴더에선 뭘 물고 있나?** 프로젝트 화면과 채팅의 🔌 칩에서 그 폴더에 적용되는 서버를 보여줘요. 가까운 설정이 우선이고(local > project > 전역), 꺼졌거나 승인 전이거나 다른 설정에 가려진 서버도 표시해요.
- **실제로 썼나?** Claude Code·Codex 세션 기록에서 호출 횟수, 쓴 도구, 마지막 사용, 쓴 세션을 읽어요. 아무도 안 쓰는 서버는 컨텍스트만 차지해요.
- **연결은 되나?** ↻ / 「연결 확인」은 그 폴더에서 `claude mcp list`를 실행해요. Baton에서 시작한 세션은 서버별 연결 상태를 기록하고, 연결 실패·인증 필요는 응답 중에 바로 알려줘요.
- 환경 변수·헤더 값은 브라우저에 보여주지 않고, 토큰처럼 보이는 인자와 URL 파라미터는 가려요.

## 폰에서 쓰기

Baton은 `127.0.0.1`에서만 열려요. **시작하기 → 폰 연결**이 순서대로 안내해요.

1. PC에 [Tailscale](https://tailscale.com/download)을 설치하고 로그인해요.
2. 폰에도 Tailscale을 설치하고(QR 코드를 찍으면 설치 페이지가 열려요) 같은 계정으로 로그인해요. 폰이 들어오면 Baton이 알아채요.
3. **내 기기에 공유**를 누르고, 화면의 QR 코드를 폰 카메라로 찍어요. 내 테일넷 안에서만 열리고 인터넷에는 공개되지 않아요.
4. **홈 화면에 추가**하고 설정에서 알림을 켜요 (iOS는 홈 화면에 추가한 앱만 알림을 받을 수 있어요).

비밀번호는 없어요. Baton은 요청의 Tailscale 계정을 확인해요. 특정 계정만 허용하려면 `BATON_ALLOWED_LOGINS=me@example.com`으로 실행하세요. 자세한 내용은 [SECURITY.md](SECURITY.md)에 있어요.

## AI의 질문에 답하기

에이전트가 골라 달라고 하면 채팅에서 바로 답해요.

- **Claude Code** — 질문 도구(AskUserQuestion)가 보기·여러 개 선택·직접 입력이 있는 카드로 떠요. 누르면 답이 전달되고 응답이 이어져요. 화면을 안 보고 있으면 폰으로 알림이 와요.
- **모든 CLI** — 답변이 질문과 짧은 보기 목록으로 끝나면 보기가 버튼으로 바뀌어요. 누르면 그 보기가 다음 메시지로 가요.

## 작업 폴더

새 세션과 작업 폴더 옮기기에서 하위 폴더를 직접 탐색해 선택할 수 있어요. 프로젝트 목록은 이름·경로로 검색할 수 있어요. 기본 작업 폴더는 **Baton 실행 계정의 홈** 아래 `workspace`가 있으면 그 폴더, 없으면 홈 폴더예요. 자동으로 폴더를 만들지는 않아요. **설정 → 작업 폴더 → 기본 작업 폴더 → 변경**에서 원하는 폴더를 선택하면 이후 새 세션에 적용돼요. 폰에서도 폰 저장소가 아닌 Baton이 실행 중인 컴퓨터의 홈 폴더 안을 탐색해요.

## 화면 테마

넓은 화면에서는 사이드바가 있는 스튜디오 레이아웃, 폰에서는 간결한 레이아웃이에요. **설정 → 화면 · 언어**에서 색상 테마(기본, Forest, Nord, Dracula, Tokyo Night, Monokai, Rosé Pine)와 밝게·어둡게·시스템 설정을 고를 수 있어요.

## 업데이트

Baton은 하루 몇 번 새 릴리스를 확인하고, 새 버전이 나오면 홈 배너와 알림으로 한 번 알려줘요. **지금 업데이트**를 누르면 새 버전을 받고(`git pull --ff-only`) 패키지를 설치한 뒤 다시 켜져요. 대화 기록과 설정은 그대로예요. zip으로 설치했거나 Baton 폴더에 고친 파일이 있으면 직접 하는 방법을 안내해요. 설정 맨 아래 버전 줄에서 언제든 확인할 수 있고, 알림은 **설정 → 알림**에서 끌 수 있어요.

## 동작 방식

```
 각 CLI ──기록──▶ 세션 파일 (~/.claude, ~/.codex, …) ──읽기──▶ Baton ──▶ 브라우저 / 폰
                                                  ▲                  │
                                                  └── claude -p --resume, codex exec resume, … ◀── 메시지 보내기
```

Baton은 빌드 과정이 없는 작은 Node.js 서버예요. 대화 내용을 따로 저장하지 않고, CLI가 남긴 파일을 읽고 CLI를 그대로 실행해요. Baton 자체 상태(고정·브리핑·설정)는 내 컴퓨터의 `data/` 폴더에만 있어요.

## 문제 해결

| 증상 | 해결 |
|---|---|
| 설치했는데 *설치 안 됨*으로 보여요 | 시작하기에서 ↻. Windows는 Baton을 다시 실행해야 새 PATH가 반영돼요. |
| 터미널에선 되는데 Baton에서 실패해요 | **설정 → 회사 환경**을 확인하세요. 필요한 변수가 Baton이 읽지 않은 셸에만 있을 수 있어요. 거기에 추가하세요. |
| 포트 7420이 이미 사용 중 | `BATON_PORT=7421 npm start` |
| Windows에서 Codex·Antigravity가 이상해요 | WSL에서 가장 잘 동작해요. WSL 안에서 `./scripts/setup.sh`를 실행하고 Windows 브라우저로 `http://localhost:7420`을 여세요. |
| 폰에서 개발 서버가 안 열려요 | Vite 같은 개발 서버는 외부 주소를 막아요. `server.allowedHosts`를 설정하세요. |

## 기여

이슈와 PR 환영해요 — [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 있어요.

## 라이선스

[MIT](LICENSE) — 자유롭게 쓰고 고치고 배포할 수 있어요. 저작권 표시만 남겨주세요.
