# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
yarn install        # 의존성 설치
yarn build          # dist/ 폴더에 빌드 + .zip 생성 (prebuild가 dist 삭제)
yarn release        # release-it으로 버전 범프 + GitHub Release 생성
```

빌드 결과물(`dist/`)을 Chrome에 로드하려면: `chrome://extensions` → 개발자 모드 활성화 → "압축 해제된 확장 프로그램 로드" → `dist/` 선택.

## Architecture

4개 컴포넌트가 계층 구조로 통신한다:

```
sidepanel.js  ──chrome.runtime.sendMessage──▶  background.js (Service Worker)
                                                      │
                              chrome.runtime.sendNativeMessage
                                                      │
                                                native-host/host.js (Node.js)
                                                      │
                                               spawn opencode serve
                                                      │
                                          OpenCode Server (localhost:4096)
```

### background.js (Service Worker)
- `manifest.json`에서 `"type": "module"`로 선언된 ES 모듈
- 포트 4096~4105 범위를 스캔해 실행 중인 OpenCode 서버를 찾고, 없으면 Native Messaging으로 시작 요청
- Side Panel과는 `chrome.runtime.sendMessage`로 통신; 응답 청크는 `message-chunk` / `message-complete` 액션으로 역방향 push
- 세션별 SSE 연결(`EventSource`)을 `eventSources` Map으로 관리; 60초 타임아웃
- 30초마다 `periodicServerCheck`로 서버 포트 변경 감지

### sidepanel/sidepanel.js
- 모든 백엔드 통신은 `sendMessageToBackground(action, data)` 헬퍼를 통해 background로 위임
- SSE 청크는 background가 push하면 `chrome.runtime.onMessage`로 수신해 실시간 렌더링
- 초기화 순서: `init-server` → `get-models` → `create-session`

### native-host/host.js
- Chrome Native Messaging 프로토콜: stdin/stdout, 메시지 앞에 4바이트 LE 길이 헤더
- `which` 모듈로 `opencode` 바이너리 경로 탐색 후 `spawn('opencode', ['serve', '--port', port])`
- 지원 액션: `start` / `stop` / `status` / `check-port`

### OpenCode REST API (background.js가 직접 호출)
| 엔드포인트 | 용도 |
|-----------|------|
| `GET /global/health` | 서버 상태 확인 |
| `POST /session` | 세션 생성 |
| `DELETE /session/{id}` | 세션 삭제 |
| `POST /session/{id}/prompt` | 메시지 전송 |
| `GET /event?session={id}` | SSE 스트림 구독 |
| `GET /config/providers` | 모델 목록 |
| `PATCH /config` | 모델 변경 |

## Key Constraints

- **빌드 파이프라인 없음**: Webpack/Vite 미사용. `scripts/build.js`는 단순 파일 복사 + zip. 소스 파일을 직접 수정하면 빌드에 반영됨.
- **테스트 없음**: 테스트 프레임워크 미설정.
- **Windows 전용 Native Host**: `native-host/`는 Windows 레지스트리(`install.reg`)에 경로를 등록해야 동작. WSL에서는 개발만 가능.
- **native-host/manifest.json의 `allowed_origins`**: `"chrome-extension://*"` (와일드카드)로 설정 — 실제 배포 시 특정 Extension ID로 교체 필요.
- **i18n**: UI 텍스트는 `_locales/ko/messages.json`에서 관리; `manifest.json`의 이름/설명은 `__MSG_*__` 형식 사용.
