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

## 회사 환경 (Bedrock·Vertex·게이트웨이·사내 LLM·프록시)

Baton은 터미널에서 실행하는 것과 똑같이 CLI를 실행해서, 회사에서 해둔 설정이 그대로 동작해요.

- **셸 환경 그대로** — 시작할 때 로그인 셸 환경(`~/.bashrc`, `~/.zshrc` 등)을 읽어 모든 CLI에 넘겨요. 백그라운드 서비스로 실행돼도 `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE`, `ANTHROPIC_BASE_URL`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS` 같은 설정이 그대로 적용돼요. 추가 변수는 **설정 → 회사 환경 · CLI 환경 변수**에서 넣을 수 있어요 (비밀 값은 가려져요).
- **Claude Code를 Amazon Bedrock·Google Vertex·Microsoft Foundry·LLM 게이트웨이·API 키로 쓰는 경우** — 자동으로 알아봐요 (`claude auth status`도 확인). 시작하기 화면은 준비 완료로, 한도 화면은 "구독 한도 없음"으로 보여주고(토큰 사용량은 그대로 보여요), 모델 선택은 별칭과 설정된 `ANTHROPIC_MODEL`·`ANTHROPIC_DEFAULT_*_MODEL`을 보여줘요. Bedrock/Vertex 모델 ID와 추론 프로필 ARN도 읽기 쉽게 표시해요.
- **Codex의 사용자 지정 `model_provider`(Azure OpenAI·사내 게이트웨이)나 API 키** — `config.toml`에서 알아보고, 그 공급자의 `env_key`가 설정됐는지 보여줘요.
- **어떤 모델 이름이든** — 모든 모델 선택에 "모델 ID 직접 입력"이 있어요.
- **설정 폴더 위치 변경** — `CLAUDE_CONFIG_DIR`, `CODEX_HOME`을 따라가요 (바꾼 뒤 Baton 재시작).

지원 밖: 회사 정책으로 특정 권한 모드(예: 전체 허용)를 막아두면 그 실행은 CLI 자체 오류로 실패해요.

## 폰에서 쓰기

Baton은 `127.0.0.1`에서만 열려요. 폰에서 쓰려면 PC와 폰에 [Tailscale](https://tailscale.com/download)을 설치하고 시작하기 화면에서 **내 기기에 공유**를 누르세요. (`tailscale serve --https=8443` — 내 테일넷 안에서만 보이고 인터넷에 공개되지 않아요.) 폰에서 `https://<PC이름>.<tailnet>.ts.net:8443`을 열고 홈 화면에 추가한 뒤 설정에서 알림을 켜면 돼요.

## 문제 해결

- **설치했는데 "설치 안 됨"으로 보여요** — 시작하기에서 ↻. Windows는 Baton을 다시 실행해야 새 PATH가 반영돼요.
- **포트 7420이 이미 사용 중** — `BATON_PORT=7421 npm start`
- **Windows**: Codex·Antigravity는 WSL에서 가장 잘 동작해요. WSL 안에서 `./scripts/setup.sh`를 실행하고 Windows 브라우저에서 `http://localhost:7420`을 여세요.
- 번역 누락 확인: `npm run i18n:check`
