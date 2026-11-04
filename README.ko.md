<div align="center">

# 🏃 Baton

**AI 코딩 세션을 한곳에서.**
Claude Code · Codex · Antigravity · OpenCode · Cursor — PC에서도, 폰에서도.

[![CI](https://github.com/SongKye/baton/actions/workflows/ci.yml/badge.svg)](https://github.com/SongKye/baton/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SongKye/baton?include_prereleases)](https://github.com/SongKye/baton/releases)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933)
![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows%20%7C%20WSL-555)

[English](README.md) · 한국어

</div>

---

바이브코딩을 하다 보면 여러 프로젝트를 여러 AI 도구로 동시에 굴리게 되고, 어디까지 했는지 자주 잊어버려요.
Baton은 각 CLI가 이미 남기고 있는 세션 기록을 모아서 한 화면에 보여주고, 브라우저나 폰에서 바로 이어서 대화하게 해줘요.

- 🗂 **모든 세션을 한 목록에** — 제목·미리보기·검색·고정, 지금 돌고 있는 세션 표시 (터미널에서 돌아도)
- 💬 **어디서든 이어서** — 실시간 답변, 도구 실행 내역, 사진 첨부, 메시지마다 모델·노력·권한 선택
- 🧭 **"어디까지 했더라?"** — 프로젝트별 AI 브리핑(한 일, 다음 할 일, 바로 보낼 요청문)과 잊힌 프로젝트 알림
- 🔀 **한도 나눠 쓰기** — 같은 프로젝트에서 다른 CLI로 새 세션, 또는 토큰이 부족할 때 세션 넘기기
- 📊 **한도·사용량** — 구독 한도 실시간, CLI·모델별 토큰 사용량
- 🖥 **서빙 중인 포트 · 🧩 스킬 · 🧹 정리** — 어디서 뭐가 떠 있는지, 실제로 쓰인 스킬, 쓸모없는 세션 한 번에 정리
- 🔔 **알림** — 답변이 끝나면 폰으로
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

1. **내 컴퓨터** — OS, Node.js, Git (Windows·macOS는 Git 원클릭 설치)
2. **AI 코딩 도구** — 각 회사 공식 설치 방법으로 원클릭 설치, 로그인도 화면 안에서 (로그인 링크·기기 코드·코드 붙여넣기)
3. **구독 없이 연결** — API 키, Bedrock, Vertex, 게이트웨이, 내 서버 + **연결 테스트** 버튼
4. **폰에서 쓰기** (선택) — Tailscale로 내 기기에만 공유
5. **자동 시작** (선택) — systemd / launchd / Windows 시작프로그램

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

구독이 없어도 돼요. **시작하기 → API·회사·내 서버로 연결**에서:

| 가진 것 | 고를 곳 | Baton이 저장하는 것 |
|---|---|---|
| Anthropic API 키 | Claude Code → *Anthropic API 키* | `~/.claude/settings.json` (`env`) |
| AWS Bedrock 권한 | Claude Code → *Amazon Bedrock* | `CLAUDE_CODE_USE_BEDROCK`, 리전, 프로필, 모델 |
| GCP Vertex 권한 | Claude Code → *Google Vertex AI* | `CLAUDE_CODE_USE_VERTEX`, 프로젝트, 리전, 모델 |
| **Anthropic Messages API**를 지원하는 게이트웨이·자체 서빙 (예: LiteLLM) | Claude Code → *LLM 게이트웨이 · 내 서버* | `ANTHROPIC_BASE_URL`, 토큰, 모델 |
| OpenAI API 키 | Codex → *OpenAI API 키* | `codex login --with-api-key` |
| **OpenAI Responses API**를 지원하는 Azure OpenAI·게이트웨이·서버 | Codex → *내 서버* | `~/.codex/config.toml` 공급자 |
| Ollama·vLLM·LM Studio 등 (**chat completions**만 지원) | OpenCode → *OpenAI 호환 서버* | `opencode.json` 공급자 |

저장할 때는 기존 파일을 먼저 백업하고, 터미널에서도 똑같이 동작해요. 저장 후 **연결 테스트**로 한 줄짜리 요청을 보내 확인할 수 있어요.

> Codex는 Responses API만 지원해요 (`wire_api = "chat"`은 없어졌어요). chat만 되는 서버는 OpenCode로 쓰거나, 앞에 LiteLLM 같은 프록시를 두세요.

### 회사 PC에서

- **터미널 환경을 그대로 써요.** 시작할 때 로그인 셸(`~/.bashrc`, `~/.zshrc`)을 읽어서 모든 CLI에 넘겨요. 백그라운드 서비스로 돌아도 `AWS_PROFILE`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS` 같은 설정이 적용돼요. 그 밖의 값은 **설정 → 회사 환경 · CLI 환경 변수**에 넣으면 돼요.
- 설정 폴더를 옮겨둔 경우(`CLAUDE_CONFIG_DIR`, `CODEX_HOME`)도 따라가요.
- Bedrock·API·게이트웨이는 한도 화면에 "구독 한도 없음"으로 나오고, 모델 선택은 그 방식이 이해하는 이름만 보여주며, 어디서든 모델 ID를 직접 입력할 수 있어요.

## 폰에서 쓰기

Baton은 `127.0.0.1`에서만 열려요. PC와 폰에 [Tailscale](https://tailscale.com/download)을 설치하고 시작하기에서 **내 기기에 공유**를 누르세요. 내 테일넷 안에서만 열리고 인터넷에는 공개되지 않아요. 폰에서 링크를 열어 **홈 화면에 추가**한 뒤 설정에서 알림을 켜세요 (iOS는 홈 화면에 추가한 앱만 알림을 받을 수 있어요).

새 기기는 처음 한 번 비밀번호를 넣어요 (기본 **`0000`** — **설정 → 보안**에서 꼭 바꾸세요). 그 뒤 30일 동안 기억해요. 자세한 내용은 [SECURITY.md](SECURITY.md)에 있어요.

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
