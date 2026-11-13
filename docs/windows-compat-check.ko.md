# Windows에서 AI 도구 호환성 검증하기 (따라하기)

Windows PC에서 Claude Code·Codex·OpenCode가 Baton과 잘 동작하는지 테스트하고, 결과를 호환표의 **Windows 칸**에 기록하는 방법이에요.
아래 회색 상자 안의 명령을 **그대로 복사해서 붙여넣고 Enter**만 누르면 돼요.

- 걸리는 시간: 처음엔 20~30분, 두 번째부터는 10분 정도예요.
- 평소 쓰는 CLI, 로그인, 세션, 설치된 Baton은 **건드리지 않아요**. 모든 테스트는 별도 폴더에서 해요.

---

## 0. PowerShell 열기

1. 키보드의 **Windows 키**를 눌러요.
2. `powershell`이라고 입력해요.
3. **Windows PowerShell**을 클릭해요. 파란색이나 검은색 창이 열려요.

> 붙여넣기는 창 안에서 **마우스 오른쪽 클릭**을 하면 돼요.

준비물이 있는지 확인해요. 아래를 붙여넣고 Enter를 눌러요.

```powershell
git --version; node --version
```

- `git version 2.xx`와 `v22.xx` 이상이 보이면 OK예요.
- 오류가 나면 Baton 설치가 먼저 필요해요.

---

## 1. 검증용 폴더 받기

### 처음 한 번만

```powershell
cd $HOME
git clone https://github.com/SongKye/baton baton-dev
cd $HOME\baton-dev
npm.cmd ci --omit=dev
```

`added ... packages`가 보이면 끝났어요.

### 두 번째부터 (최신으로 업데이트)

```powershell
cd $HOME\baton-dev
git pull
npm.cmd ci --omit=dev
```

---

## 2. GitHub CLI 설치하고 로그인하기 (처음 한 번만)

결과를 GitHub에 기록하는 데 필요해요.

```powershell
winget install --id GitHub.cli -e
```

- 설치 중에 `Y`를 물어보면 `Y`를 입력하고 Enter를 눌러요.
- 설치가 끝나면 **PowerShell 창을 닫고, 0번처럼 새로 열어요.** 이 단계가 꼭 필요해요.

새 창에서 아래를 실행해요.

```powershell
gh auth login
```

질문이 차례로 나와요. 방향키로 고르고 Enter를 눌러요.

| 질문 | 고를 것 |
|---|---|
| Where do you use GitHub? | **GitHub.com** |
| What is your preferred protocol for Git operations? | **HTTPS** |
| Authenticate Git with your GitHub credentials? | **Y** |
| How would you like to authenticate GitHub CLI? | **Login with a web browser** |

1. 화면에 `XXXX-XXXX` 같은 **8자리 코드**가 나와요. 메모해두세요.
2. Enter를 누르면 브라우저가 열려요.
3. 코드를 입력하고 **Authorize**를 눌러요.

잘 됐는지 확인해요.

```powershell
gh auth status
```

`Logged in to github.com account SongKye`가 보이면 OK예요.

---

## 3. 테스트 전용 로그인 (처음 한 번만)

평소 쓰는 로그인과 **따로** 쓰는 테스트용 로그인이에요. 평소 계정으로 로그인하면 돼요.

```powershell
cd $HOME\baton-dev
npm.cmd run compat:smoke -- --login
```

1. **Claude Code가 먼저 나와요.**
   - 브라우저가 열리면 로그인하고 승인해요. 브라우저가 안 열리면 화면에 나온 주소를 복사해서 열어요.
   - 화면에 **코드**가 나오면 복사해서 PowerShell에 붙여넣고 Enter를 눌러요.
2. **이어서 Codex가 나와요.**
   - 화면에 나온 **주소**를 브라우저로 열어요.
   - 화면에 나온 **코드**를 입력하고 승인해요.
3. 마지막에 `Done: both are signed in.`이 보이면 끝났어요.

> Claude Code나 Codex가 이 PC에 설치되어 있지 않아도 괜찮아요. 테스트 폴더에 알아서 설치해요.

---

## 4. 먼저 테스트만 해보기 (기록하지 않음)

```powershell
cd $HOME\baton-dev
npm.cmd run compat:smoke -- --install
```

처음에는 CLI를 테스트 폴더에 설치해서 5~10분 정도 걸려요. 끝나면 이런 화면이 나와요.

```
claude: v2.1.318 PASS
  ✓ new session ...
codex: v0.156.0 PASS
opencode: v1.19.5 PASS
agy: skipped — not installed

3 passed, skipped: agy
```

- `PASS`면 통과예요.
- **agy(Antigravity)는 Windows용이 없어서 skipped가 정상이에요.**
- `FAIL`이 있으면 5번으로 넘어가지 말고, **화면 전체를 복사해서** Claude에게 보여주세요.

---

## 5. 결과를 Windows 칸에 기록하기

4번이 괜찮았으면 실행해요.

```powershell
cd $HOME\baton-dev
npm.cmd run compat:smoke -- --report
```

같은 테스트를 한 번 더 하고 GitHub에 PR을 만들어요. CI가 통과하면 **자동으로 머지돼요.** CI는 몇 분 걸려요.

마지막에 이런 줄이 보이면 끝났어요.

```
PR https://github.com/SongKye/baton/pull/... : merged
```

이제 Baton **설정 → AI 도구 지원 버전**의 `OS별 검증` 줄에 Windows 버전이 표시돼요. GitHub 호환표는 최대 6시간 뒤에 반영돼요.

---

## 다음에 다시 할 때

1번의 "두 번째부터"를 하고, 5번만 하면 돼요.

```powershell
cd $HOME\baton-dev
git pull
npm.cmd ci --omit=dev
npm.cmd run compat:smoke -- --report
```

---

## 문제가 생겼을 때

| 화면에 나온 말 | 해결 |
|---|---|
| `이 시스템에서 스크립트를 실행할 수 없으므로…` | `npm` 대신 **`npm.cmd`**로 입력했는지 확인해요. 위 명령은 모두 `npm.cmd`예요. |
| `'gh' 용어가 … 인식되지 않습니다` | PowerShell 창을 닫고 새로 열어요. 2번의 설치 직후 필요한 단계예요. |
| `skipped — test home not signed in` | 3번을 다시 해요. |
| `maintainers only` | `gh auth status`로 **SongKye** 계정인지 확인해요. 아니면 `gh auth login`을 다시 해요. |
| `nothing new to record` | 이미 기록된 버전이에요. 정상이에요. |
| 그 밖의 오류 | **PowerShell 화면 전체를 복사해서** Claude에게 보여주세요. |
