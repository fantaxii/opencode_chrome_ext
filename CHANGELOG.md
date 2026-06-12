# Changelog

# [2.1.0](https://github.com/fantaXII/opencode_chrome_ext/compare/v2.0.0...v2.1.0) (2026-06-12)


### Bug Fixes

* MV3 SW 재시작 시 불필요한 작업 제거 및 alarms 안정화 ([ff66887](https://github.com/fantaXII/opencode_chrome_ext/commit/ff6688707ec7ae17d078d582664ae9791afaa5e9))
* resolve native messaging failures for WSL opencode ([4491c68](https://github.com/fantaXII/opencode_chrome_ext/commit/4491c68874f3d1746aadd5621b9a1b0adfd091b5))
* resolve native messaging protocol bugs and WSL path detection ([4b6bdae](https://github.com/fantaXII/opencode_chrome_ext/commit/4b6bdaefc3d27ebf6f0062e60e227c0120de6163))
* retry native messaging and WSL path detection on server connection failure ([5a26bd8](https://github.com/fantaXII/opencode_chrome_ext/commit/5a26bd8d03956705ff26d8990f5e331a11d5d381))
* return headings and paragraphs as arrays instead of strings ([b00ff20](https://github.com/fantaXII/opencode_chrome_ext/commit/b00ff20ab956e455651f497d5a293c059dbf84b9))
* SSE 세션 필터에서 메시지 ID를 세션 ID로 잘못 사용하는 문제 수정 ([48f366d](https://github.com/fantaXII/opencode_chrome_ext/commit/48f366d8ef5a381cef975fc88bbb6d9d21d2ce0c))
* SSE 타임아웃 90초 → 180초로 연장 ([6ba81b9](https://github.com/fantaXII/opencode_chrome_ext/commit/6ba81b928d7da3007e2e3b74ae5011d53d304c16))
* SW 재시작 시 탭 세션 상태 유실 문제 수정 ([94c82a4](https://github.com/fantaXII/opencode_chrome_ext/commit/94c82a4bd5b6288a75273854ddd9a28405b13529))
* SW 재시작 후 페이지 변경 알림이 누락되는 문제 수정 ([426aad5](https://github.com/fantaXII/opencode_chrome_ext/commit/426aad5c2e200ace1bb83abbd3fe5a6b5b65266f))
* Windows 경로를 WSL 경로로 자동 변환 ([358889e](https://github.com/fantaXII/opencode_chrome_ext/commit/358889eb5f6ce00680d4188f8eec0d10164ef7c1))
* Windows 콘솔에서 한글 깨짐 및 install.bat 명령 오류 수정 ([ac9fc62](https://github.com/fantaXII/opencode_chrome_ext/commit/ac9fc6202974f31f2514a1e88ed965b183c7e0e8))
* Windows에서 .CMD 파일 spawn 시 EINVAL 오류 수정 ([7355313](https://github.com/fantaXII/opencode_chrome_ext/commit/73553136733a06ccf06370a544a62aa688b537cc))
* working folder 기본 디렉토리 표시 안 되는 문제 수정 ([1843c3f](https://github.com/fantaXII/opencode_chrome_ext/commit/1843c3fdcfbff40cc84ee5d4396fc56f150d9a7f))
* working folder 표시 영역 확대 및 tooltip 수정 ([8cff81c](https://github.com/fantaXII/opencode_chrome_ext/commit/8cff81c54798f725405949f8ae6c45253c3ebc01))
* WSL opencode 탐지 실패 수정 — NVM 설치 환경 지원 ([cdbeb4f](https://github.com/fantaXII/opencode_chrome_ext/commit/cdbeb4fd2f3733fb8698ac4e827ebd180c3756e6))
* 디버그 다이얼로그 z-index 및 native host 설치 시 node.exe 절대경로 고정 ([c636a4b](https://github.com/fantaXII/opencode_chrome_ext/commit/c636a4bf7eeeaac16b6c6d0d2cc14645fc9a3f40))
* 라이트 모드에서 연결 중 오버레이 글씨가 보이지 않는 문제 수정 ([fdeeda2](https://github.com/fantaXII/opencode_chrome_ext/commit/fdeeda22b830c6eab24b34adf41260e47b9d2831))
* 서버 미연결 상태에서 잘못된 '연결됨' 표시 및 /debug 사용 불가 문제 수정 ([30c3b6b](https://github.com/fantaXII/opencode_chrome_ext/commit/30c3b6b676e712aa9696371317a825e2f6ba7978))
* 초기 화면 OpenCode 브랜딩으로 교체 및 탭 로드 버그 수정 ([387efe0](https://github.com/fantaXII/opencode_chrome_ext/commit/387efe0a9554284bc94d1b0d168eb34936196d73))
* 컨텍스트 메뉴로 보낸 텍스트 입력 후 포커스 안정성 보강 ([83a9e34](https://github.com/fantaXII/opencode_chrome_ext/commit/83a9e341d0146cbc065d1b25495e0ae64aa66462))
* 프록시 환경에서 Node.js 자동 설치 및 npm install 실패 문제 개선 ([fc65054](https://github.com/fantaXII/opencode_chrome_ext/commit/fc65054817de87a834e3f6c89c27059367ac449b))


### Features

* /model 커맨드 인자 없이 입력 시 채팅 내 모델 선택 UI 표시 ([b1f1636](https://github.com/fantaXII/opencode_chrome_ext/commit/b1f163678e86cd327303db7eb7bcf32c3e281731))
* add connecting indicator with spinner animation for server connection status ([f7c1bb0](https://github.com/fantaXII/opencode_chrome_ext/commit/f7c1bb061e2531932906949f0d5a3622ff5e6c8e))
* add right-click context menu to send selected text to side panel ([1dd7869](https://github.com/fantaXII/opencode_chrome_ext/commit/1dd7869b463275ef523ed7fa997058c35ce37059))
* add WSL opencode auto-start support via native messaging ([f34f9b7](https://github.com/fantaXII/opencode_chrome_ext/commit/f34f9b75ee9bd310a74823cb536ea0331759c8ed))
* native host 설치용 install.bat 래퍼 추가 ([252ba23](https://github.com/fantaXII/opencode_chrome_ext/commit/252ba235d3b1687f112a87b6d1d4f2973a5e7165))
* Node.js 미설치 PC에서 자동 설치 지원 (winget → MSI fallback) ([d751de6](https://github.com/fantaXII/opencode_chrome_ext/commit/d751de6a03fbd02de632a40ccbe31e0ba023b63b))
* OpenCode SSE 이벤트로 기본 디렉토리 표시 (WSL 지원) ([44b1641](https://github.com/fantaXII/opencode_chrome_ext/commit/44b164143888b6204951bd86ddb24c073c4db478))
* replace mode-select with working folder display ([09461a7](https://github.com/fantaXII/opencode_chrome_ext/commit/09461a72896f369f489c4bfbff0953f623f02198))
* Shift+Tab으로 에이전트(모드) 전환 기능 추가 ([e7c986f](https://github.com/fantaXII/opencode_chrome_ext/commit/e7c986f4a7ab5b3f842b3a7656f252fdf46e4278))
* SSE 타임아웃 개선 및 마크다운 렌더링 적용 ([2b9e9a9](https://github.com/fantaXII/opencode_chrome_ext/commit/2b9e9a9ad658655dbc6ea458d8148fdf99728e25))
* working folder UI 개편 및 헤더 정리 ([2c177d5](https://github.com/fantaXII/opencode_chrome_ext/commit/2c177d55131690808e5b7433d3fbece6be5de665))
* working folder 기본 디렉토리 표시 ([75be061](https://github.com/fantaXII/opencode_chrome_ext/commit/75be0615ad835c95c605b63c17d43d64794764f8))
* 디버그 로깅 시스템 추가 (/debug 커맨드) ([87fa999](https://github.com/fantaXII/opencode_chrome_ext/commit/87fa999d0e4eef9fe09a9fbef31dfa69f26e3f43))
* 메시지 송수신 흐름에 디버그 로그 추가 ([d41c386](https://github.com/fantaXII/opencode_chrome_ext/commit/d41c386e28280816bd05131f4433c27cf32bf43f))
* 메시지 전송 중 취소 버튼 추가 ([1922be9](https://github.com/fantaXII/opencode_chrome_ext/commit/1922be98a09ec9d71f996293ade05145baad03be))
* 사이드 패널 슬래시 커맨드(/command) 지원 추가 ([bbc4a45](https://github.com/fantaXII/opencode_chrome_ext/commit/bbc4a4552296360afc022a29dccf5e05c2c6f059))
* 사이드 패널 헤더에 MCP 서버 상태 표시 및 on/off 토글 기능 추가 ([5cb95ff](https://github.com/fantaXII/opencode_chrome_ext/commit/5cb95ff06c80a2a74fa8abc8c2b19e5f4b185fb2))
* 첫 메시지 수신 후 working folder 기본값 즉시 업데이트 ([2383d7c](https://github.com/fantaXII/opencode_chrome_ext/commit/2383d7cff2c5f0743e0c84ce1327607a830c2311))
* 페이지 변경 감지 시 사이드패널에 새 컨텍스트 안내 추가 ([a73ea74](https://github.com/fantaXII/opencode_chrome_ext/commit/a73ea74b3b4af4b5013ea3b244372ca669285c22))
