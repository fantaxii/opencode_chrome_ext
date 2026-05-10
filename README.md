# OpenCode Chrome Extension

Chrome Extension을 통해 OpenCode를 사이드패널에서 사용할 수 있도록 하는 프로젝트입니다.

## 📋 목차

1. [개요](#개요)
2. [아키텍처](#아키텍처)
3. [사전 요구사항](#사전-요구사항)
4. [디렉토리 구조](#디렉토리-구조)
5. [설계 상세](#설계-상세)
6. [구현 내용](#구현-내용)
7. [개발](#개발)
8. [빌드 및 배포](#빌드-및-배포)
9. [Windows 설치 가이드](#windows-설치-가이드)
10. [사용 방법](#사용-방법)

---

## 개요

### 주요 기능

- **사이드패널 채팅 UI**: Chrome 사이드패널에서 OpenCode와 채팅
- **자동 서버 실행**: Native Messaging Host를 통해 OpenCode 서버 자동 시작/관리
- **세션 관리**: 탭마다 독립적인 세션 생성
- **웹페이지 컨텍스트**: 현재 탭의 URL과 제목을 자동으로 컨텍스트에 포함
- **모델 변경**: 사용자가 모델 선택 가능
- **MCP/Skill 지원**: OpenCode의 MCP 서버 및 Skill 활용 가능

### 기술 스택

- **Chrome Extension**: Manifest V3
- **Native Messaging Host**: Node.js (Windows)
- **OpenCode Server**: REST API + SSE

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Windows Chrome                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────────┐  │
│  │   Side Panel    │───▶│  Service Worker │───▶│   Native       │  │
│  │   (Chat UI)     │    │  (Background)   │    │   Messaging    │  │
│  └─────────────────┘    └─────────────────┘    │   Host         │  │
│                                                └────────┬─────────┘  │
│                                                         │            │
│                                    stdin/stdout         │            │
│                                    (JSON Protocol)      │            │
│                                                         ▼            │
│                                              ┌────────────────────┐  │
│                                              │  OpenCode Server   │  │
│                                              │  (localhost:4096)  │  │
│                                              └────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 설명

| 컴포넌트 | 역할 |
|---------|------|
| Side Panel (Chat UI) | 사용자 인터페이스 - 메시지 입력, 응답 표시 |
| Service Worker | HTTP API 통신, 이벤트 관리, 서버 상태 모니터링 |
| Native Messaging Host | OpenCode 서버 시작/중지 명령, 포트 관리 |
| OpenCode Server | AI 채팅 처리, MCP/Skill 실행, REST API 제공 |

---

## 사전 요구사항

### 개발 환경 (WSL - 코드 작성용)

```bash
- Node.js 18+
- yarn 1.22+
- Git
```

### 실행 환경 (Windows - 실제 사용)

```bash
- Windows 10/11
- Google Chrome (최신 버전)
- Node.js 18+ (Native Messaging Host 실행용)
- OpenCode CLI 설치됨
```

---

## 디렉토리 구조

```
opencode-chrome-ext/
├── manifest.json              # Chrome Extension Manifest V3
├── background.js              # Service Worker (핵심 로직)
├── sidepanel/
│   ├── sidepanel.html         # 사이드패널 HTML
│   ├── sidepanel.js           # 사이드패널 로직
│   └── styles.css             # 스타일
├── native-host/               # Native Messaging Host (Windows 전용)
│   ├── manifest.json          # Native Messaging 매니페스트
│   ├── host.js                # Node.js 호스트 프로그램
│   ├── install.reg            # 레지스트리 등록 파일
│   └── uninstall.reg          # 레지스트리 제거 파일
├── _locales/
│   └── ko/
│       └── messages.json       # 한국어 번역
├── icons/                     # 확장 프로그램 아이콘
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── build.js               # 빌드 스크립트
├── package.json               # npm 패키지 설정
├── release.config.js          # release-it 설정
└── README.md                  # 이 문서
```

---

## 설계 상세

### 1. OpenCode 서버 관리

#### 서버 상태 확인 로직

```javascript
async function ensureOpenCodeServer() {
  // 1. 기본 포트(4096)에서 서버 상태 확인
  for (let port = 4096; port < 4106; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/global/health`);
      if (res.ok) return { port, available: true };
    } catch {
      continue;
    }
  }

  // 2. 서버가 없으면 Native Messaging으로 시작 명령
  await chrome.runtime.sendNativeMessage('com.opencode.chrome', {
    action: 'start',
    preferredPort: 4096
  });

  // 3. 서버 시작 대기 후 재확인
  return await waitForServer();
}
```

#### 포트 충돌 처리

- OpenCode는 기본적으로 4096 포트 사용
- 이미 사용 중이면 **자동으로 다음 사용 가능한 포트** 할당
- Extension에서는 서버 상태를 확인하고 **실제 사용 중인 포트에 연결**

### 2. 세션 관리

#### 세션 생성 규칙

```
새 탭 열림 → 새로운 세션 생성
세션 ID: UUID 기반 (ses_xxxxxxxxxxxxxxxx)
각 세션은 독립적인 컨텍스트 유지
```

#### 메시지 전송 Flow

```javascript
async function sendMessage(sessionId, message, tabInfo) {
  // 1. 현재 페이지 정보 포함
  const fullMessage = `
현재 페이지 정보:
- URL: ${tabInfo.url}
- 제목: ${tabInfo.title}

${message}
  `;

  // 2. 메시지 전송 (POST /session/{id}/prompt)
  await fetch(`${SERVER_URL}/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: [{ type: 'text', text: fullMessage }]
    })
  });

  // 3. SSE로 응답 스트리밍 수신
  const eventSource = new EventSource(`${SERVER_URL}/event?session=${sessionId}`);
  // 응답 처리...
}
```

### 3. Native Messaging Host 프로토콜

#### 메시지 형식

**Chrome → Native Host (JSON)**
```json
{
  "action": "start" | "stop" | "status" | "check-port",
  "preferredPort": 4096
}
```

**Native Host → Chrome (JSON)**
```json
{
  "status": "success" | "error",
  "port": 4096,
  "version": "1.14.0"
}
```

### 4. UI/UX 설계

#### 사이드패널 레이아웃

```
┌─────────────────────────────────────────────┐
│  🔧 설정  │  OpenCode Chat  │  모델 선택 ▼   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 🤖 OpenCode                         │   │
│  │ 안녕하세요! 무엇을 도와드릴까요?    │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 👤 사용자                           │   │
│  │ 이 코드 설명해줘                    │   │
│  └─────────────────────────────────────┘   │
│                                             │
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐   │
│  │ 메시지 입력...                    │📤 │
│  └─────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

#### 디자인 원칙

- **미니멀**: 복잡한 기능 없이 핵심 채팅 기능만
- **반응형**: 사이드패널 크기에 맞춰自适应
- **테마**: 다크/라이트 모드 지원 (Chrome 테마 따름)

---

## 구현 내용

### manifest.json (Chrome Extension)

```json
{
  "manifest_version": 3,
  "name": "OpenCode Chat",
  "version": "1.0.0",
  "description": "OpenCode를 사이드패널에서 사용하는 Chrome 확장 프로그램",
  "permissions": [
    "sidePanel",
    "activeTab",
    "nativeMessaging"
  ],
  "host_permissions": [
    "http://127.0.0.1:*/*"
  ],
  "action": {
    "default_title": "OpenCode 열기"
  },
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  }
}
```

### background.js (Service Worker)

주요 기능:
1. OpenCode 서버 상태 관리 (Health Check)
2. Native Messaging Host 통신
3. 세션 관리 (세션 생성/삭제)
4. 메시지 전송 및 SSE 응답 처리
5. 모델 변경 API 호출

### native-host/host.js (Node.js)

주요 기능:
1. OpenCode 서버 시작 (`opencode serve`)
2. 서버 상태 모니터링
3. 포트 자동 할당
4. stdin/stdout을 통한 JSON 프로토콜 통신

### sidepanel/sidepanel.js

주요 기능:
1. 메시지 입력 및 전송
2. 응답 표시 (마크다운 렌더링)
3. 모델 선택 UI
4. 설정 패널

---

## 개발

### 로컬 개발 설정

```bash
# 1. 저장소 클론
git clone https://github.com/your-repo/opencode-chrome-ext.git
cd opencode-chrome-ext

# 2. 의존성 설치
yarn install

# 3. Chrome에 확장 프로그램 로드
# - chrome://extensions 이동
# - 개발자 모드 활성화
# - "압축 해제된 확장 프로그램 로드" 클릭
# - 현재 디렉토리 선택
```

### Native Messaging Host 설정 (Windows)

```bash
# 1. Native Messaging Host 설치 (관리자 권한)
# 레지스트리 등록 또는 install.reg 더블 클릭

# 2. 테스트
node native-host/host.js --test

# 3. Chrome에서 Native Messaging 활성화 확인
# - chrome://extensions → 세부 정보 → "네이티브 메시징 허용" 확인
```

---

## 빌드 및 배포

### 빌드 명령

```bash
# 프로덕션 빌드 (dist 폴더에 결과물 + .zip 생성)
yarn build

# 또는 release-it 사용 (GitHub Release 포함)
yarn release-it
```

`yarn build` 실행 결과:
- `dist/` - Chrome에 로드 가능한 확장 프로그램 파일
- `dist/opencode-chrome-ext-v{version}.zip` - 배포용 ZIP 파일

### release-it 설정

`release.config.js`에 설정된 배포 흐름:

1. **Version Bump**: semver에 따른 버전 증가
2. **Changelog 생성**: Git 커밋 로그 기반
3. **Git Tag**: 버전 태그 생성
4. **GitHub Release**: 릴리스 노트와 함께 릴리스 생성

#### 사전 설정: GitHub Token

`.env_example`을 복사해서 `.env` 파일을 만들고 토큰을 입력합니다:

```bash
cp .env_example .env
# .env 파일을 열어 GITHUB_TOKEN 값 입력
```

GitHub Personal Access Token 발급: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → `repo` 권한 체크

#### 릴리스 명령

```bash
# 버그 수정 (0.0.1 → 0.0.2)
yarn release-it patch --ci --no-npm

# 기능 추가 (0.0.1 → 0.1.0)
yarn release-it minor --ci --no-npm

# 호환성 변경 (0.0.1 → 1.0.0)
yarn release-it major --ci --no-npm
```

실행 결과: git commit + tag 생성, push, GitHub Release 자동 생성

### Chrome Web Store 배포

```bash
# 1. 빌드 실행 (dist 폴더와 .zip 자동 생성)
yarn build

# 2. Chrome Web Store 개발자 대시보드 접속
# https://chrome.google.com/webstore/developer/

# 3. 새 항목 업로드
# - dist/opencode-chrome-ext-v{version}.zip 업로드
# - Store listings 정보 입력
# - 스크린샷/설명 추가
# - 제출
```

---

## Windows 설치 가이드

### Step 1: Chrome Extension 설치

1. 이 저장소를克隆 또는 Release에서 `.zip` 다운로드
2. Chrome에서 `chrome://extensions` 열기
3. 개발자 모드 활성화
4. "압축 해제된 확장 프로그램 로드" 선택
5. 프로젝트 디렉토리 선택

### Step 2: Native Messaging Host 설치

#### 방법 1: 자동 설치 (권장)

```powershell
# 1. 압축 해제된 폴더에서 native-host 폴더로 이동
#    예: opencode-chrome-ext-v1.0.0\native-host\

# 2. 해당 폴더에서 PowerShell 실행 (또는 파일 우클릭 -> "PowerShell로 실행")
powershell -ExecutionPolicy Bypass -File .\install.ps1

# 기본 설치 위치: %LOCALAPPDATA%\OpenCodeChrome
# (예: C:\Users\<username>\AppData\Local\OpenCodeChrome)
```

#### 방법 2: 수동 설치

```powershell
# 1. native-host 폴더를 원하는 위치에 복사
#    예: C:\Program Files\OpenCodeChrome\native-host\

# 2. manifest.json의 path를 실제 경로로 수정
#    "path": "C:\\Program Files\\OpenCodeChrome\\native-host\\host.js"

# 3. 레지스트리 등록
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome" /ve /d "C:\Program Files\OpenCodeChrome\native-host\manifest.json" /f
```

### Step 3: Native Messaging Host 실행

```powershell
# Node.js로 호스트 프로그램 실행
cd native-host
node host.js

# 또는 백그라운드 서비스로 등록 (선택사항)
```

### Step 4: 작동 확인

1. Chrome에서 확장 프로그램 아이콘 클릭
2. 사이드패널이 열림
3. 메시지 입력하여 테스트

---

## 사용 방법

### 기본 사용

1. Chrome에서 웹페이지 浏览
2. 확장 프로그램 아이콘 클릭 또는 우클릭 → "OpenCode 열기"
3. 사이드패널에서 메시지 입력
4. OpenCode가 응답

### 모델 변경

1. 사이드패널 상단 모델 선택 드롭다운 클릭
2. 사용 가능한 모델 목록에서 선택
3. 선택 즉시 새 모델로 전환

### MCP/Skill 사용

메시지에 MCP 서버 또는 Skill 이름 포함:

```
@filesystem read /path/to/file

@visualize.create-slides "presentation about: topic"

/help
```

### 세션 관리

- 새 탭에서 확장 프로그램 열면 자동으로 새 세션
- 세션은 OpenCode 서버에 독립적으로 관리됨

---

## Troubleshooting

### "Specified native messaging host not found" 오류

- 레지스트리에 Native Messaging Host가 등록되지 않음
- install.reg 파일을 실행하거나 레지스트리 수동 등록

### 서버 연결 실패

```bash
# OpenCode 서버 수동 시작 테스트
opencode serve --port 4096
```

### 포트 충돌

- 이미 다른 OpenCode 인스턴스가 실행 중
- 기본적으로 다음 사용 가능한 포트 자동 탐색

---

## 라이선스

MIT License

---

## 기여

Contributions are welcome! Please read the contributing guidelines first.