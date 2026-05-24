/**
 * OpenCode Chrome Extension - Background Service Worker
 * 
 * 주요 기능:
 * - OpenCode 서버 상태 관리
 * - Native Messaging Host 통신
 * - 세션 관리
 * - 메시지 전송 및 SSE 응답 처리
 */

// ============================================
// 상수 정의
// ============================================

const NATIVE_HOST_NAME = 'com.opencode.chrome';
const DEFAULT_PORT = 4096;
const MAX_PORT_CHECK = 10; // 4096 ~ 4105
const SERVER_START_TIMEOUT = 30000; // 30초
const SSE_RECONNECT_DELAY = 2000;

// ============================================
// 상태 관리
// ============================================

let serverState = {
  port: DEFAULT_PORT,
  available: false,
  version: null,
  checking: false
};

let sessions = new Map();
let tabSessions = new Map(); // tabId → sessionId
let activeTabs = new Set();  // 사용자가 명시적으로 extension을 연 tabId 목록
let currentSessionId = null;
let eventSources = new Map();
let selectedModel = null; // { providerID, modelID }

// 저장된 모델 복원 (SW 재시작 시에도 유지)
chrome.storage.local.get('selectedModel').then(({ selectedModel: saved }) => {
  if (saved) selectedModel = saved;
}).catch(() => {});

// 탭 닫힐 때 세션 및 활성 탭 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  const sessionId = tabSessions.get(tabId);
  if (sessionId) {
    deleteSession(sessionId).catch(() => {});
    tabSessions.delete(tabId);
  }
});

// ============================================
// 서버 상태 관리
// ============================================

/**
 * OpenCode 서버 상태 확인
 */
async function checkServerHealth(port) {
  console.log(`[checkServerHealth] 포트 ${port} 상태 체크 중...`);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[checkServerHealth] 포트 ${port} 응답: status=${response.status}, ok=${response.ok}`);
    if (response.ok) {
      const data = await response.json();
      console.log(`[checkServerHealth] 포트 ${port} 성공 - version=${data.version}`);
      return { available: true, version: data.version };
    }
  } catch (error) {
    console.log(`[checkServerHealth] 포트 ${port} 실패:`, error.message);
  }
  return { available: false, version: null };
}

/**
 * 사용 가능한 포트 찾기
 */
async function findAvailablePort() {
  console.log(`[findAvailablePort] ${DEFAULT_PORT} ~ ${DEFAULT_PORT + MAX_PORT_CHECK - 1} 범위 포트 스캔 시작`);
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + MAX_PORT_CHECK; port++) {
    const state = await checkServerHealth(port);
    if (state.available) {
      console.log(`[findAvailablePort] 포트 ${port} 발견!`);
      return port;
    }
  }
  console.log(`[findAvailablePort] 모든 포트 실패 - 사용 가능한 서버 없음`);
  return null;
}

/**
 * Native Messaging Host를 통해 서버 시작
 */
async function startServerWithNativeMessaging(preferredPort = DEFAULT_PORT) {
  console.log(`[startServerWithNativeMessaging] Native Messaging 호출 - preferredPort=${preferredPort}`);
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'start',
      preferredPort: preferredPort
    });

    console.log(`[startServerWithNativeMessaging] Native Messaging 응답:`, response);
    if (response.status === 'success') {
      console.log(`[startServerWithNativeMessaging] 성공 - port=${response.port}`);
      return response.port;
    }
    console.error(`[startServerWithNativeMessaging] 실패 - status=${response.status}`);
    return null;
  } catch (error) {
    console.error('[startServerWithNativeMessaging] Native Messaging 시작 실패:', error);
    return null;
  }
}

/**
 * 서버가 사용 가능할 때까지 대기
 */
async function waitForServer(timeout = SERVER_START_TIMEOUT) {
  const startTime = Date.now();
  console.log(`[waitForServer] 서버 시작 대기 시작 - timeout=${timeout}ms`);

  while (Date.now() - startTime < timeout) {
    const port = await findAvailablePort();
    if (port) {
      console.log(`[waitForServer] 서버 발견! 포트 ${port}`);
      return port;
    }
    console.log(`[waitForServer] 서버 못 찾음. 1초 후 재시도... (경과: ${Date.now() - startTime}ms)`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[waitForServer] 타임아웃 - ${timeout}ms 내 서버 없음`);
  return null;
}

/**
 * OpenCode 서버 초기화
 */
async function ensureOpenCodeServer() {
  if (serverState.checking) {
    console.log(`[ensureOpenCodeServer] 이미 checking 중입니다. 기존 포트 ${serverState.port} 반환`);
    return serverState.port;
  }

  serverState.checking = true;
  console.log(`[ensureOpenCodeServer] checking=true - 서버 확인 시작`);

  try {
    let port = null;

    const existingPort = await findAvailablePort();
    if (existingPort) {
      serverState.port = existingPort;
      serverState.available = true;
      const health = await checkServerHealth(existingPort);
      serverState.version = health.version;
      console.log(`[ensureOpenCodeServer] 기존 OpenCode 서버 발견: 포트 ${existingPort}, version=${health.version}`);
      port = existingPort;
    } else {
      console.log(`[ensureOpenCodeServer] OpenCode 서버 없음, Native Messaging으로 시작 시도...`);
      const startedPort = await startServerWithNativeMessaging();
      console.log(`[ensureOpenCodeServer] Native Messaging 결과: startedPort=${startedPort}`);

      if (startedPort) {
        port = await waitForServer();
        if (port) {
          serverState.port = port;
          serverState.available = true;
          const health = await checkServerHealth(port);
          serverState.version = health.version;
          console.log(`[ensureOpenCodeServer] OpenCode 서버 시작 완료: 포트 ${port}, version=${health.version}`);
        }
      }
    }

    if (port && !selectedModel) {
      console.log(`[ensureOpenCodeServer] 모델 동기화 시작...`);
      await syncModelFromServer(port);
    }

    if (port) {
      console.log(`[ensureOpenCodeServer] 성공 - 포트 ${port} 반환`);
      return port;
    }

    console.error(`[ensureOpenCodeServer] OpenCode 서버 시작 실패`);
    return null;
  } finally {
    serverState.checking = false;
    console.log(`[ensureOpenCodeServer] checking=false - 작업 완료`);
  }
}

/**
 * 서버 상태Periodic 확인
 */
async function periodicServerCheck() {
  console.log(`[periodicServerCheck] 주기 체크 시작 - 현재 serverState.port=${serverState.port}, available=${serverState.available}`);
  const port = await findAvailablePort();
  console.log(`[periodicServerCheck] findAvailablePort 결과: port=${port}, 기존 serverState.port=${serverState.port}`);
  if (port !== serverState.port) {
    console.log(`[periodicServerCheck] 서버 포트 변경 감지! ${serverState.port} → ${port}`);
    serverState.port = port;
    serverState.available = !!port;
    console.log(`[periodicServerCheck] 상태 업데이트 완료 - port=${port}, available=${serverState.available}`);
  } else {
    console.log(`[periodicServerCheck] 포트 변경 없음 (${port})`);
  }
}

// Periodic 체크 설정 (30초마다)
setInterval(periodicServerCheck, 30000);

async function getWorkingDirectory() {
  try {
    const result = await chrome.storage.local.get('workingDirectory');
    return result.workingDirectory || '';
  } catch {
    return '';
  }
}

// ============================================
// 세션 관리
// ============================================

/**
 * UUID 생성
 */
function generateUUID() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 새 세션 생성
 */
async function createSession(title = 'New Chat') {
  const port = await ensureOpenCodeServer();
  if (!port) {
    throw new Error('OpenCode 서버 연결 실패');
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      throw new Error(`세션 생성 실패: ${response.status}`);
    }

    const sessionData = await response.json();
    const sessionId = sessionData.id || sessionData.session?.id;

    if (!sessionId) {
      throw new Error('세션 ID를 찾을 수 없음');
    }

    sessions.set(sessionId, {
      id: sessionId,
      created: Date.now(),
      port: port,
      active: true
    });

    console.log(`세션 생성 완료: ${sessionId}`);
    return sessionId;
  } catch (error) {
    console.error('세션 생성 오류:', error);
    throw error;
  }
}

/**
 * 세션 삭제
 */
async function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    await fetch(`http://127.0.0.1:${session.port}/session/${sessionId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('세션 삭제 오류:', error);
  }

  sessions.delete(sessionId);

  // SSE 연결 정리
  const eventSource = eventSources.get(sessionId);
  if (eventSource) {
    eventSource.close();
    eventSources.delete(sessionId);
  }
}

/**
 * 현재 탭 정보를 가져오기
 */
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { tabId: null, url: '', title: '', favIconUrl: '' };
    }

    const result = {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl
    };

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'get-page-content' });
      if (response?.success) {
        result.pageContent = response.content;
      }
    } catch (e) {
      console.log('content script 호출 실패 (일반적인 웹페이지가 아님):', e.message);
    }

    return result;
  } catch (error) {
    console.error('getCurrentTabInfo 오류:', error);
    return { tabId: null, url: '', title: '', favIconUrl: '' };
  }
}

// ============================================
// 메시지 전송 및 응답 처리
// ============================================

/**
 * 메시지 전송
 */
async function sendMessage(sessionId, message, tabInfo, onChunk, onComplete) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('세션을 찾을 수 없음');
  }

  const port = await ensureOpenCodeServer();
  if (!port) {
    throw new Error('OpenCode 서버 연결 실패');
  }

  try {
    const workingDir = await getWorkingDirectory();
    const headers = { 'Content-Type': 'application/json' };
    if (workingDir) headers['x-opencode-directory'] = workingDir;

    let fullMessage = message;
    if (tabInfo?.url || tabInfo?.pageContent) {
      let pageContext = '';
      if (tabInfo.url) {
        pageContext += `
---
현재 페이지 정보:
- 제목: ${tabInfo.title}
- URL: ${tabInfo.url}
`;
      }
      if (tabInfo.pageContent) {
        const content = tabInfo.pageContent;
        if (content.headings?.length) {
          pageContext += `제목들:\n${content.headings.join('\n')}\n\n`;
        }
        if (content.paragraphs?.length) {
          pageContext += `내용 요약:\n${content.paragraphs.join('\n')}\n\n`;
        }
        if (content.selectedText) {
          pageContext += `선택한 텍스트:\n${content.selectedText}\n\n`;
        }
      }
      fullMessage = pageContext + message;
    }

    const promptResponse = await fetch(
      `http://127.0.0.1:${port}/session/${sessionId}/prompt_async`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...(selectedModel && { model: selectedModel }),
          parts: [{ type: 'text', text: fullMessage }]
        })
      }
    );
    if (promptResponse.status !== 204 && promptResponse.status !== 202 && !promptResponse.ok) {
      throw new Error(`메시지 전송 실패: ${promptResponse.status}`);
    }

    subscribeToEvents(sessionId, port, onChunk, onComplete);
  } catch (error) {
    console.error('메시지 전송 오류:', error);
    throw error;
  }
}

/**
 * SSE 이벤트 구독 (/global/event + Last-Event-ID 재연결)
 * server.connected 수신 시 resolve → 이후 prompt_async 전송
 * 스트림 종료 시 Last-Event-ID로 재연결하여 응답 이벤트 수신
 */
function subscribeToEvents(sessionId, port, onChunk, onComplete) {
  const existing = eventSources.get(sessionId);
  if (existing) existing.abort();

  const controller = new AbortController();
  eventSources.set(sessionId, controller);

  return new Promise((resolveConnected) => {
    let resolved = false;
    let buffer = '';
    let completed = false;
    let assistantMessageId = null;
    let textPartIds = new Set();

    const timeoutId = setTimeout(() => {
      if (!completed) {
        controller.abort();
        eventSources.delete(sessionId);
        onComplete(buffer || '', '응답 시간 초과');
      }
    }, 60000);

    function resolveOnce() {
      if (!resolved) { resolved = true; resolveConnected(); }
    }

    async function connect(lastEventId = '') {
      if (completed || controller.signal.aborted) return;

      try {
        const headers = { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' };
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;

        const response = await fetch(
          `http://127.0.0.1:${port}/global/event`,
          { headers, signal: controller.signal }
        );

        if (!response.ok) {
          resolveOnce();
          clearTimeout(timeoutId);
          onComplete('', `SSE 연결 실패: ${response.status}`);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        let currentId = lastEventId;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          pending += decoder.decode(value, { stream: true });

          // SSE 이벤트는 \n\n 으로 구분
          const parts = pending.split('\n\n');
          pending = parts.pop();

          for (const part of parts) {
            let sseId = '';
            let sseData = '';

            for (const line of part.split('\n')) {
              if (line.startsWith('id:')) sseId = line.slice(3).trim();
              else if (line.startsWith('data:')) sseData = line.slice(5).trim();
            }

            if (sseId) currentId = sseId;
            if (!sseData) continue;

            try {
              const raw = JSON.parse(sseData);
              // /global/event 는 { directory, payload } 래퍼
              const evt = raw.payload || raw;
              // id 가 SSE id: 필드 없이 JSON 안에 있을 경우 fallback
              if (!currentId && raw.id) currentId = raw.id;


              if (evt.type === 'server.connected') {
                resolveOnce();
                continue;
              }

              // 세션 ID 필터
              const evtSession = evt.properties?.sessionID
                || evt.properties?.part?.sessionID
                || evt.properties?.info?.id;
              if (evtSession && evtSession !== sessionId) continue;

              switch (evt.type) {
                case 'message.updated': {
                  const info = evt.properties?.info;
                  if (info?.role === 'assistant' && info?.sessionID === sessionId) {
                    assistantMessageId = info.id;

                    // 현재 선택된 모델 정보 감지 및 저장
                    if (info.modelID && info.providerID) {
                      selectedModel = { providerID: info.providerID, modelID: info.modelID };
                      chrome.storage.local.set({ selectedModel }).catch(() => {});
                      console.log('모델 정보 저장됨:', selectedModel);
                    }
                  }
                  break;
                }
                case 'message.part.updated': {
                  const part = evt.properties?.part;
                  if (part?.type === 'text' && part.messageID === assistantMessageId) {
                    textPartIds.add(part.id);
                  }
                  break;
                }
                case 'message.part.delta': {
                  const props = evt.properties;
                  if (textPartIds.has(props?.partID) && props?.delta) {
                    buffer += props.delta;
                    onChunk(props.delta);
                  }
                  break;
                }
                case 'session.idle': {
                  completed = true;
                  clearTimeout(timeoutId);
                  controller.abort();
                  eventSources.delete(sessionId);
                  onComplete(buffer);
                  return;
                }
                case 'session.error': {
                  completed = true;
                  clearTimeout(timeoutId);
                  controller.abort();
                  eventSources.delete(sessionId);
                  const errMsg = evt.properties?.error?.data?.message
                    || evt.properties?.error?.message
                    || evt.properties?.error?.name
                    || '오류가 발생했습니다';
                  onComplete(null, errMsg);
                  return;
                }
              }
            } catch (e) {
              console.error('SSE 파싱 오류:', e, sseData);
            }
          }
        }

        // 스트림 정상 종료 → Last-Event-ID 로 재연결
        if (!completed && !controller.signal.aborted) {
          await new Promise(r => setTimeout(r, 500));
          connect(currentId);
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('SSE 오류:', error);
        resolveOnce();
        if (!completed && !controller.signal.aborted) {
          await new Promise(r => setTimeout(r, 2000));
          connect(lastEventId);
        }
      }
    }

    connect();
    // 5초 내 server.connected 없으면 강제 resolve
    setTimeout(resolveOnce, 5000);
  });
}

/**
 * 현재 서버 설정 가져오기
 */
async function getCurrentServerConfig() {
  const port = await ensureOpenCodeServer();
  if (!port) return null;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/config`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('서버 설정 가져오기 실패:', error);
  }
  return null;
}

/**
 * 모델 목록 가져오기
 */
async function getAvailableModels() {
  const port = await ensureOpenCodeServer();
  if (!port) return [];

  try {
    const response = await fetch(`http://127.0.0.1:${port}/config/providers`);
    if (response.ok) {
      const data = await response.json();
      return data.providers || [];
    }
  } catch (error) {
    console.error('모델 목록 가져오기 실패:', error);
  }
  return [];
}

/**
 * 모델 변경
 */
async function setModel(providerId, modelName) {
  const port = await ensureOpenCodeServer();
  if (!port) return false;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: providerId,
        model: modelName
      })
    });
    return response.ok;
  } catch (error) {
    console.error('모델 변경 실패:', error);
    return false;
  }
}

/**
 * 서버의 현재 모델 정보를 동기화
 */
async function syncModelFromServer(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/config`);
    if (response.ok) {
      const config = await response.json();
      if (config.model && config.provider) {
        selectedModel = { providerID: config.provider, modelID: config.model };
        chrome.storage.local.set({ selectedModel });
        console.log('서버 모델 동기화됨:', selectedModel);
      }
    }
  } catch (error) {
    console.log('서버 모델 동기화 실패:', error);
  }
}

// ============================================
// Chrome 메시징 (Side Panel과 통신)
// ============================================

// 메시지 핸들러
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'init-server':
          const port = await ensureOpenCodeServer();
          if (port && !selectedModel) {
            await syncModelFromServer(port);
            if (!selectedModel) {
              const models = await getAvailableModels();
              if (models.length > 0 && models[0].models) {
                const provider = models[0];
                const firstModel = Array.isArray(provider.models)
                  ? provider.models[0]
                  : Object.values(provider.models)[0];
                if (firstModel) {
                  selectedModel = {
                    providerID: provider.id,
                    modelID: firstModel.id || firstModel.name
                  };
                  chrome.storage.local.set({ selectedModel });
                  console.log('첫 번째 model 자동 선택:', selectedModel);
                }
              }
            }
          }
          sendResponse({ success: !!port, available: !!port, port, version: serverState.version });
          break;

        case 'create-session':
          const sessionId = await createSession(message.title || 'New Chat');
          currentSessionId = sessionId;
          sendResponse({ success: true, sessionId });
          break;

        case 'send-message':
          if (!sessions.has(message.sessionId)) {
            const recoveredPort = await ensureOpenCodeServer();
            if (recoveredPort) {
              sessions.set(message.sessionId, {
                id: message.sessionId,
                port: recoveredPort,
                active: true
              });
            }
          }
          const tabInfo = await getCurrentTabInfo();
          await sendMessage(
            message.sessionId,
            message.message,
            tabInfo,
            (chunk) => {
              chrome.runtime.sendMessage({
                action: 'message-chunk',
                sessionId: message.sessionId,
                chunk: chunk
              }).catch(() => {});
            },
            (final, error) => {
              chrome.runtime.sendMessage({
                action: 'message-complete',
                sessionId: message.sessionId,
                content: final,
                error: error
              });
            }
          );
          sendResponse({ success: true });
          break;

        case 'has-tab-session':
          sendResponse({ has: tabSessions.has(message.tabId) });
          break;

        case 'get-tab-session': {
          const tabId = message.tabId;
          const existingId = tabId ? tabSessions.get(tabId) : null;
          if (existingId && sessions.has(existingId)) {
            sendResponse({ success: true, sessionId: existingId, isNew: false });
          } else {
            const newId = await createSession(message.title || 'New Chat');
            if (tabId) tabSessions.set(tabId, newId);
            currentSessionId = newId;
            sendResponse({ success: true, sessionId: newId, isNew: true });
          }
          break;
        }

        case 'get-working-directory':
          sendResponse({ directory: await getWorkingDirectory() });
          break;

        case 'set-working-directory':
          await chrome.storage.local.set({ workingDirectory: message.directory });
          sendResponse({ success: true });
          break;

        case 'get-models':
          const models = await getAvailableModels();
          sendResponse({ success: true, models });
          break;

        case 'get-current-model':
          sendResponse({ model: selectedModel });
          break;

        case 'set-model':
          selectedModel = { providerID: message.providerId, modelID: message.modelName };
          chrome.storage.local.set({ selectedModel }).catch(() => {});
          sendResponse({ success: true });
          break;

        case 'get-server-state':
          sendResponse({
            available: serverState.available,
            port: serverState.port,
            version: serverState.version
          });
          break;

        case 'get-tab-info':
          const currentTabInfo = await getCurrentTabInfo();
          sendResponse(currentTabInfo);
          break;

        case 'get-session':
          const session = sessions.get(message.sessionId);
          sendResponse(session || null);
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();

  return true; // 비동기 응답
});

// ============================================
// 사이드패널 이벤트 (탭별 독립 제어)
// ============================================

// 아이콘 클릭 시 해당 탭에만 Panel 활성화
try {
  if (chrome.sidePanel) {
    // 전역 자동 열기 비활성화 — 탭별로 수동 제어
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    // 전역 기본값: 비활성
    chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  }
} catch (e) {}

// async/await 없이 동기 호출 — user gesture 컨텍스트 유지 필수
chrome.action.onClicked.addListener((tab) => {
  if (!chrome.sidePanel) return;
  // enabled: true 먼저 (await 없음)
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel/sidepanel.html',
    enabled: true
  });
  // open()은 바로 호출 — 여전히 gesture 컨텍스트 안
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => {
    console.error('사이드패널 열기 실패:', e.message);
  });
  activeTabs.add(tab.id);
  chrome.runtime.sendMessage({ action: 'reinit-for-tab', tabId: tab.id }).catch(() => {});
});

// 탭 전환 시 — 활성 탭이면 Panel 유지, 아니면 닫기
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!chrome.sidePanel) return;
  if (activeTabs.has(tabId)) {
    chrome.sidePanel.setOptions({ tabId, path: 'sidepanel/sidepanel.html', enabled: true }).catch(() => {});
  } else {
    chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
  }
});

// ============================================
// Native Messaging 연결 테스트
// ============================================

// Native Messaging 호스트 연결 테스트
async function testNativeMessaging() {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'status'
    });
    console.log('Native Messaging 연결 성공:', response);
    return true;
  } catch (error) {
    console.log('Native Messaging 연결 실패:', error.message);
    return false;
  }
}

// 초기화 시 Native Messaging 테스트
testNativeMessaging();

console.log('OpenCode Chrome Extension Background Service Worker 로드 완료');