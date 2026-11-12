# Baton 사용 가이드

[← README](../README.ko.md) · [English](guide.md)

## 목차

- [설치와 다시 실행](#빠른-시작) · [Windows / WSL](#windows-wsl에-설치하기-단계별)
- [지원 현황](#지원-현황) · [내 모델과 회사 계정](#내-모델-연결하기)
- [MCP 서버](#mcp-서버) · [폰 연결](#폰에서-쓰기)
- [AI의 질문에 답하기](#ai의-질문에-답하기) · [작업 폴더](#작업-폴더) · [화면 테마](#화면-테마)
- [업데이트](#업데이트) · [동작 방식](#동작-방식) · [문제 해결](#문제-해결)

## 빠른 시작

**Git과 Node.js 22.13 이상**이 필요해요. 설치 스크립트가 Node.js 설치를 도와줄 수 있어요. macOS·Linux·WSL은 Git을 먼저 준비하세요. Windows는 `winget`이 있으면 Git 설치도 안내해요.

<table>
<tr><th>macOS · Linux · WSL</th><th>Windows (PowerShell)</th></tr>
<tr><td>

```bash
curl -fsSL https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.sh | bash
```

</td><td>

```powershell
irm https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.ps1 | iex
```

</td></tr>
</table>

**최신 릴리스**를 `~/baton`에 설치하고 바로 켜요(다른 폴더는 `BATON_DIR`로 지정). 같은 줄을 다시 실행하면 가장 새 릴리스로 바뀌어요. zip이 편하면 [Releases](https://github.com/SongKye/baton/releases)에서 `baton-vX.Y.Z.zip`을 받아 풀고 `scripts/setup.sh`(또는 `scripts\setup.ps1`)를 실행하세요. zip 설치는 스스로 업데이트하지 못해요. Baton 자체를 고치려면 [CONTRIBUTING.md](../CONTRIBUTING.md)를 보세요.

**Linux/macOS/WSL은 http://localhost:7420**, **Windows 네이티브는 http://localhost:7421**로 대시보드를 자동으로 열어요. 포트가 사용 중이면 다른 포트를 선택하고 설치 폴더의 `data/listener-<platform>.json`에 저장해 다음 실행과 자동 시작에도 사용해요. 실제 주소는 터미널에 표시돼요. Windows와 WSL은 각 사용자 홈에 독립적으로 설치할 수 있어요. 설치·데이터 폴더는 서로 공유하지 마세요.

**시작하기** 화면이 순서대로 안내해요.

1. **컴퓨터 준비** — OS, Node.js, Git (Windows·macOS는 Git 원클릭 설치)
2. **AI 연결** — AI를 쓰는 방법을 고르세요
   - *구독 계정* — 각 회사 공식 설치 방법으로 원클릭 설치, 로그인도 화면 안에서 (로그인 링크·기기 코드·코드 붙여넣기)
   - *API 키* — 붙여넣으면 Anthropic·OpenAI·OpenRouter·Groq 키를 알아보고 맞는 CLI에 연결해요
   - *회사 계정* — Bedrock, Vertex, Azure OpenAI, 사내 게이트웨이
   - *내 컴퓨터·서버의 모델* — Ollama·LM Studio·vLLM·LiteLLM·llama.cpp·Jan을 자동으로 찾아요
3. **도구 붙이기 (MCP)** (선택) — 고르면 연결 테스트까지 해서 CLI마다 맞게 추가
4. **폰 연결** (선택) — Tailscale을 단계별로 따라 하고 QR 코드를 찍으면 끝
5. **자동 시작** (선택) — systemd / launchd / Windows 시작프로그램

단계마다 끝났는지 표시되고, 연결은 **연결 테스트**로 확인할 수 있어요.

CLI를 설치하면 기존 세션이 바로 나타나요.

**대시보드를 닫았거나 Baton이 꺼졌다면?** 포트 번호나 폴더를 기억할 필요 없어요.

- **Windows** — 시작 메뉴(또는 바탕화면)의 **Baton** 아이콘을 누르세요. Baton이 최소화된 창으로 켜지고(그 창을 닫으면 꺼져요), 이미 켜져 있으면 대시보드만 열어요.
- **macOS · Linux · WSL** — 터미널을 열고 `baton`을 입력하세요. 동작은 같고 **Ctrl+C**로 꺼요. (설치할 때 `~/.local/bin`에 추가돼요. 명령을 못 찾으면 `~/baton/scripts/baton`을 실행하세요.)

### Windows: WSL에 설치하기 (단계별)

Codex와 Antigravity는 Baton을 WSL(Windows 안의 Linux)에서 돌릴 때 가장 잘 돼요. 화면은 평소 쓰는 Windows 브라우저로 열어요.

1. **WSL 켜기** (한 번만). PowerShell을 **관리자 권한으로** 열고 `wsl --install`을 실행한 뒤 Windows를 다시 시작하세요. Ubuntu 창이 뜨면 Linux 사용자 이름과 비밀번호를 정해요.
2. **Baton 설치.** Ubuntu 창에 설치 명령을 붙여넣으세요.
   ```bash
   curl -fsSL https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.sh | bash
   ```
   Node.js가 필요하면 설치할지 물어보고, 끝나면 Baton을 켜고 Windows 브라우저에서 **http://localhost:7420** 을 열어요. 쓰는 동안 Ubuntu 창은 열어 두세요. **Ctrl+C**를 누르면 꺼져요.
3. **다음에 다시 켜기.** Ubuntu를 열고 입력하세요.
   ```bash
   baton
   ```
   Baton을 켜고 대시보드를 열어요. 이미 켜져 있으면 대시보드만 열어요.
   시작하기 화면에서 **자동 시작**을 켜면 터미널 없이 써요. WSL에서는 WSL이 켜질 때 Baton이 같이 켜져요(재부팅 후 Ubuntu를 한 번 열면 돼요). systemd가 필요한데, 요즘 설치한 Ubuntu에는 켜져 있어요. 시작하기에서 자동 시작을 쓸 수 없다고 나오면 `sudo nano /etc/wsl.conf`로 아래 두 줄을 넣고, PowerShell에서 `wsl --shutdown`을 실행한 뒤 Ubuntu를 다시 여세요.
   ```ini
   [boot]
   systemd=true
   ```
4. **업데이트.** 설정 맨 아래 버전 항목에서 직접 확인한 뒤 **지금 업데이트**를 누르거나, 설치 명령을 다시 실행하세요.
5. **삭제.** 시작하기에서 자동 시작을 끄고 `rm -rf ~/baton ~/.local/bin/baton`을 실행하세요. CLI와 대화 기록은 그대로 남아요.

Baton 코드를 직접 고치려면 `main`을 `git clone`해서 쓰세요. [CONTRIBUTING.md](../CONTRIBUTING.md)를 보세요.

## 지원 현황

| | 세션 보기 | 대화·새 세션 | 사진 | 실시간 한도 | 토큰 사용량 | 연결 방식 |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | ✅ | 구독 · API 키 · Bedrock · Vertex · 게이트웨이/내 서버 |
| **Codex** | ✅ | ✅ | ✅ | ✅ | ✅ | ChatGPT · API 키 · Azure OpenAI · 게이트웨이/내 서버 |
| **Antigravity** | ✅ | ✅ | ✅ | ✅ | ✅ | Google 계정 |
| **OpenCode** | ✅ | ✅ | ✅ | — | ✅ | 무료 모델 · OpenAI 호환 서버 |

**검증된 버전:** Claude Code 2.1.318 · Codex 0.156.0 · Antigravity 1.5.6 · OpenCode 1.19.5 (2026-11-12). Baton은 각 CLI의 실행 옵션·출력 형식·세션 파일에 맞춰 동작하기 때문에, CLI가 새로 나오면서 일부 기능이 멈출 수 있어요. **설정 → AI 도구 지원 버전**에서 설치된 버전과 비교해 볼 수 있어요. 연동마다 무엇에 기대고 있는지는 [CLI 호환성](compatibility.md)(영문)에 정리돼 있어요.

**Cursor — 미검증 · 공식 지원 대상 아님.** 연동 코드는 있지만 직접 테스트·검증하지 않았으며, 현재 정식 지원 계획도 없어요. 아래 Cursor 설정 경로는 기존 구현을 설명하는 참고 정보이며 동작을 보장하지 않아요.

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

### 추가하고 테스트까지 하기

**도구 → MCP 서버**의 **＋**, **시작하기 → 도구 붙이기**, 또는 프로젝트 화면의 **이 프로젝트용 MCP 추가**에서 시작해요.

1. **받은 정보 붙여넣기** — MCP 개발자가 준 걸 그대로 붙여넣으세요: 서버 URL·토큰, 설치 명령(`claude mcp add …`, `codex mcp add …`), README 일부, 다른 도구용 설정 JSON(Claude·Cursor·VS Code·OpenCode)이나 Codex TOML. 설정 JSON·TOML·설치 명령은 AI 없이 바로 읽고, 그 밖의 글은 AI CLI가 읽어요. 토큰처럼 보이는 값은 AI에게 보내기 전에 가리고 입력칸에만 채워 둬요. 잘 알려진 MCP(Context7, Playwright, GitHub, Notion …)는 **잘 알려진 MCP에서 고르기**에 따로 있어요.
2. **어디에** — **모든 폴더(전역)** 또는 **이 프로젝트에서만**. 그리고 넣을 CLI들.
3. **값 확인 · CLI별 설정 미리보기** — 토큰·키는 이 화면에만 있다가 설정 파일에 바로 저장돼요. 아래에 CLI마다 실제로 들어갈 설정(파일 위치, Claude Code는 실행할 명령까지)이 그 CLI의 형식으로 나오고, 형식에 맞는지 Baton이 다시 읽어서 확인해요.
4. **등록하고 테스트** — Baton이 서버를 직접 실행(또는 URL 호출)해서 연결과 도구 목록을 확인하고, 통과하면 CLI마다 맞는 방식으로 넣은 뒤 각 CLI에게 잘 보이는지 물어봐요(`claude mcp get`, `codex mcp get`, `agy mcp list`, 그 밖엔 설정 파일 확인). 테스트에 실패하면 아무 데도 넣지 않고, **AI에게 고쳐 달라고 하기**로 로그를 보여주면(비밀값은 가려서) 고친 설정을 제안해요.

| CLI | 전역 | 이 프로젝트에서만 |
|---|---|---|
| Claude Code | `claude mcp add-json -s user` | `-s local` (나만, git에 안 올라감) · 팀 공유를 고르면 `.mcp.json` (처음 열 때 승인) |
| Codex | `~/.codex/config.toml` | `<프로젝트>/.codex/config.toml` — Codex가 **신뢰한 폴더**에서만 읽어요 (Baton에서 신뢰 표시를 고를 수 있어요) |
| Antigravity | `~/.gemini/config/mcp_config.json` | `<프로젝트>/.agents/plugins/baton-mcp/` 작업 공간 플러그인 |
| OpenCode | `~/.config/opencode/opencode.json` | `<프로젝트>/opencode.json` (파일이 새 형식 `mcp.servers`를 쓰면 그 형식대로) |
| Cursor | `~/.cursor/mcp.json` | `<프로젝트>/.cursor/mcp.json` |

바꾸기 전 파일은 `.baton-backup`으로 남겨요. 프로젝트 파일에 토큰이 들어가는데 git이 무시하지 않는 파일이면 경고해요.
서버 화면의 **연결 테스트**는 이미 있는 서버를 같은 방식으로 확인하고, **다른 CLI에도 추가**는 설정을 그대로(같은 프로젝트 또는 전역으로) 복사하며(키 포함 — 내 컴퓨터 밖으로 나가지 않아요), **삭제**는 지워요.

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

비밀번호는 없어요. Baton은 요청의 Tailscale 계정을 확인해요. 특정 계정만 허용하려면 `BATON_ALLOWED_LOGINS=me@example.com`으로 실행하세요. 자세한 내용은 [SECURITY.md](../SECURITY.md)에 있어요.

## AI의 질문에 답하기

에이전트가 골라 달라고 하면 채팅에서 바로 답해요.

- **Claude Code** — 질문 도구(AskUserQuestion)가 보기·여러 개 선택·직접 입력이 있는 카드로 떠요. 질문이 여러 개면 한 페이지에 하나씩 보여주고, 마지막에 답을 확인한 뒤 제출해요. 답하면 응답이 이어져요. 화면을 안 보고 있으면 폰으로 알림이 와요.
- **모든 CLI** — 답변이 질문과 짧은 보기 목록으로 끝나면 보기가 버튼으로 바뀌어요. 누르면 그 보기가 다음 메시지로 가요. 보기가 달린 질문이 여러 개면 같은 페이지 카드로 보여주고, 답을 모아 한 메시지로 보내요.

## 작업 폴더

새 세션과 작업 폴더 옮기기에서 하위 폴더를 직접 탐색해 선택할 수 있어요. 프로젝트 목록은 이름·경로로 검색할 수 있어요. 기본 작업 폴더는 **Baton 실행 계정의 홈** 아래 `workspace`가 있으면 그 폴더, 없으면 홈 폴더예요. 자동으로 폴더를 만들지는 않아요. **설정 → 작업 폴더 → 기본 작업 폴더 → 변경**에서 원하는 폴더를 선택하면 이후 새 세션에 적용돼요. 폰에서도 폰 저장소가 아닌 Baton이 실행 중인 컴퓨터의 홈 폴더 안을 탐색해요.

## 화면 테마

넓은 화면에서는 사이드바가 있는 스튜디오 레이아웃, 폰에서는 간결한 레이아웃이에요. **설정 → 화면 · 언어**에서 색상 테마(기본, Forest, Nord, Dracula, Tokyo Night, Monokai, Rosé Pine)와 밝게·어둡게·시스템 설정을 고를 수 있어요.

## 업데이트

자동 릴리스 확인과 새 버전 알림(홈 배너·알림함·푸시)은 비활성화되어 있으며 켤 수 없어요. **지금 업데이트**를 누르면 새 릴리스로 바꾸고 패키지를 설치한 뒤 다시 켜져요. 대화 기록과 설정은 그대로예요. 설치 명령으로 설치했으면 릴리스끼리만 바뀌고, `main` 브랜치를 받아 둔 경우에는 `main`을 받아요. zip으로 설치했거나 Baton 폴더에 고친 파일이 있으면 직접 하는 방법을 안내해요. 0.8 이전에 `git clone`으로 설치했다면 Baton 폴더에서 `git fetch --tags && git checkout v0.8.0`을 한 번 실행하세요. 그다음부터는 릴리스를 따라가요. **설정 → Baton 버전 · 업데이트**에서 언제든 직접 확인할 수 있어요.

## 동작 방식

```
 각 CLI ──기록──▶ 세션 파일 (~/.claude, ~/.codex, …) ──읽기──▶ Baton ──▶ 브라우저 / 폰
                                                  ▲                  │
                                                  └── claude -p --resume, codex exec resume, … ◀── 메시지 보내기
```

Baton은 빌드 과정이 없는 작은 Node.js 서버예요. CLI가 남긴 세션 파일을 읽고 CLI를 그대로 실행해요. AI 요청은 각 CLI에 연결된 공급자를 통해 처리돼요. Baton 자체 상태(고정·브리핑·설정)는 내 컴퓨터의 `data/` 폴더에만 있어요.

## 문제 해결

| 증상 | 해결 |
|---|---|
| 설치했는데 *설치 안 됨*으로 보여요 | 시작하기에서 ↻. Windows는 Baton을 다시 실행해야 새 PATH가 반영돼요. |
| 터미널에선 되는데 Baton에서 실패해요 | **설정 → 회사 환경**을 확인하세요. 필요한 변수가 Baton이 읽지 않은 셸에만 있을 수 있어요. 거기에 추가하세요. |
| 포트가 이미 사용 중 | 비어 있는 포트를 자동으로 선택하고 기억해요. `BATON_PORT`를 직접 지정했다면 해제해서 자동 선택을 사용하세요. |
| Windows에서 Codex·Antigravity가 이상해요 | WSL에서 가장 잘 동작해요. [Windows: WSL에 설치하기](#windows-wsl에-설치하기-단계별)를 보세요. |
| 폰에서 개발 서버가 안 열려요 | Vite 같은 개발 서버는 외부 주소를 막아요. `server.allowedHosts`를 설정하세요. |
