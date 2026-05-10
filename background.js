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
let currentSessionId = null;
let eventSources = new Map();

// ============================================
// 서버 상태 관리
// ============================================

/**
 * OpenCode 서버 상태 확인
 */
async function checkServerHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      const data = await response.json();
      return { available: true, version: data.version };
    }
  } catch (error) {
    // 서버 연결 실패
  }
  return { available: false, version: null };
}

/**
 * 사용 가능한 포트 찾기
 */
async function findAvailablePort() {
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + MAX_PORT_CHECK; port++) {
    const state = await checkServerHealth(port);
    if (state.available) {
      return port;
    }
  }
  return null;
}

/**
 * Native Messaging Host를 통해 서버 시작
 */
async function startServerWithNativeMessaging(preferredPort = DEFAULT_PORT) {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: 'start',
      preferredPort: preferredPort
    });

    if (response.status === 'success') {
      return response.port;
    }
    return null;
  } catch (error) {
    console.error('Native Messaging 시작 실패:', error);
    return null;
  }
}

/**
 * 서버가 사용 가능할 때까지 대기
 */
async function waitForServer(timeout = SERVER_START_TIMEOUT) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const port = await findAvailablePort();
    if (port) {
      return port;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return null;
}

/**
 * OpenCode 서버 초기화
 */
async function ensureOpenCodeServer() {
  if (serverState.checking) {
    return serverState.port;
  }

  serverState.checking = true;

  try {
    // 1. 기존 서버 확인
    const existingPort = await findAvailablePort();
    if (existingPort) {
      serverState.port = existingPort;
      serverState.available = true;
      const health = await checkServerHealth(existingPort);
      serverState.version = health.version;
      console.log(`기존 OpenCode 서버 발견: 포트 ${existingPort}`);
      return existingPort;
    }

    // 2. Native Messaging으로 서버 시작 시도
    console.log('OpenCode 서버 없음, Native Messaging으로 시작 시도...');
    const startedPort = await startServerWithNativeMessaging();
    
    if (startedPort) {
      // 3. 서버 시작 대기
      const port = await waitForServer();
      if (port) {
        serverState.port = port;
        serverState.available = true;
        const health = await checkServerHealth(port);
        serverState.version = health.version;
        console.log(`OpenCode 서버 시작 완료: 포트 ${port}`);
        return port;
      }
    }

    console.error('OpenCode 서버 시작 실패');
    return null;
  } finally {
    serverState.checking = false;
  }
}

/**
 * 서버 상태Periodic 확인
 */
async function periodicServerCheck() {
  const port = await findAvailablePort();
  if (port !== serverState.port) {
    console.log('서버 포트 변경 감지, 상태 업데이트...');
    serverState.port = port;
    serverState.available = !!port;
  }
}

// Periodic 체크 설정 (30초마다)
setInterval(periodicServerCheck, 30000);

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
    return {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl
    };
  } catch (error) {
    return { url: '', title: '', favIconUrl: '' };
  }
}

// ============================================
// 메시지 전송 및 응답 처리
// ============================================

/**
 * 메시지 전송
 */
async function sendMessage(sessionId, message, onChunk, onComplete) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('세션을 찾을 수 없음');
  }

  const port = await ensureOpenCodeServer();
  if (!port) {
    throw new Error('OpenCode 서버 연결 실패');
  }

  try {
    // 1. 먼저 메시지 전송 (서버에 AI 작업 시작 요청)
    const promptResponse = await fetch(
      `http://127.0.0.1:${port}/session/${sessionId}/prompt`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: message }]
        })
      }
    );

    if (!promptResponse.ok && promptResponse.status !== 202) {
      throw new Error(`메시지 전송 실패: ${promptResponse.status}`);
    }

    // 2. SSE로 응답 스트리밍 수신
    await subscribeToEvents(sessionId, port, onChunk, onComplete);

  } catch (error) {
    console.error('메시지 전송 오류:', error);
    throw error;
  }
}

/**
 * SSE 이벤트 구독
 */
async function subscribeToEvents(sessionId, port, onChunk, onComplete) {
  // 기존 연결 종료
  const existingSource = eventSources.get(sessionId);
  if (existingSource) {
    existingSource.close();
  }

  const eventSource = new EventSource(
    `http://127.0.0.1:${port}/event?session=${sessionId}`
  );

  let buffer = '';
  let completed = false;

  eventSource.onmessage = (event) => {
    if (completed) return;

    try {
      const data = JSON.parse(event.data);
      
      // 세션 ID 확인
      if (data.sessionID !== sessionId && data.properties?.sessionID !== sessionId) {
        return;
      }

      // 이벤트 타입 처리
      const eventType = data.type || data.event;
      
      switch (eventType) {
        case 'chunk':
        case 'text-delta':
          const content = data.content || data.delta || data.text || '';
          if (content) {
            buffer += content;
            onChunk(content);
          }
          break;

        case 'message':
        case 'message-add':
          // 전체 메시지 완성
          if (data.message?.content) {
            buffer = data.message.content;
            onChunk('');
          }
          break;

        case 'done':
        case 'complete':
          completed = true;
          eventSource.close();
          eventSources.delete(sessionId);
          onComplete(buffer);
          break;

        case 'error':
          completed = true;
          eventSource.close();
          eventSources.delete(sessionId);
          onComplete(null, data.error || '오류가 발생했습니다');
          break;
      }
    } catch (error) {
      console.error('SSE 파싱 오류:', error);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE 오류:', error);
    if (!completed) {
      eventSource.close();
      eventSources.delete(sessionId);
      onComplete(buffer || '', '연결이 종료되었습니다');
    }
  };

  eventSources.set(sessionId, eventSource);

  // 타임아웃 설정 (60초)
  setTimeout(() => {
    if (!completed) {
      eventSource.close();
      eventSources.delete(sessionId);
      onComplete(buffer || '', '응답 시간 초과');
    }
  }, 60000);
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
          sendResponse({ success: !!port, port, version: serverState.version });
          break;

        case 'create-session':
          const sessionId = await createSession(message.title || 'New Chat');
          currentSessionId = sessionId;
          sendResponse({ success: true, sessionId });
          break;

        case 'send-message':
          await sendMessage(
            message.sessionId,
            message.message,
            (chunk) => {
              // 응답 청크 수신
              chrome.runtime.sendMessage({
                action: 'message-chunk',
                sessionId: message.sessionId,
                chunk: chunk
              });
            },
            (final, error) => {
              // 응답 완료
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

        case 'get-models':
          const models = await getAvailableModels();
          sendResponse({ success: true, models });
          break;

        case 'set-model':
          const result = await setModel(message.providerId, message.modelName);
          sendResponse({ success: result });
          break;

        case 'get-server-state':
          sendResponse({
            available: serverState.available,
            port: serverState.port,
            version: serverState.version
          });
          break;

        case 'get-tab-info':
          const tabInfo = await getCurrentTabInfo();
          sendResponse(tabInfo);
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
// 사이드패널 이벤트
// ============================================

try {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    chrome.sidePanel.setOptions({
      path: 'sidepanel/sidepanel.html',
      enabled: true
    }).catch(() => {});
    
    if (chrome.sidePanel.onShown) {
      chrome.sidePanel.onShown.addListener(async (tab) => {
        console.log('사이드패널 표시:', tab.id);
      });
    }
  }
} catch (e) {
  console.log('sidePanel init error:', e.message);
}

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