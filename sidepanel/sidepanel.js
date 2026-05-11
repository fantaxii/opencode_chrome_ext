(function() {
  const messagesContainer = document.getElementById('messages-container');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const modelSelect = document.getElementById('model-select');
  const connectionStatus = document.getElementById('connection-status');
  const tabInfo = document.getElementById('tab-info');
  const tabTitle = document.getElementById('tab-title');
  const loadingIndicator = document.getElementById('loading-indicator');

  let currentSessionId = null;
  let currentTabId = null;
  let isLoading = false;
  let availableModels = [];
  let selectedModel = null;

  async function init() {
    updateConnectionStatus('connecting');

    try {
      const serverState = await sendMessageToBackground('init-server');

      if (serverState.success && serverState.available) {
        updateConnectionStatus('connected');
        await loadModels();
      } else {
        updateConnectionStatus('disconnected');
      }
    } catch (error) {
      console.error('초기화 실패:', error);
      updateConnectionStatus('error');
    }

    // 현재 탭으로 초기화
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) await reinitForTab(activeTab);
  }

  async function reinitForTab(tab) {
    // UI 초기화
    currentTabId = tab.id;
    currentSessionId = null;
    isLoading = false;
    loadingIndicator.classList.add('hidden');
    sendBtn.disabled = !messageInput.value.trim();
    messagesContainer.innerHTML = `
      <div class="welcome-message">
        <div class="message bot-message">
          <div class="message-avatar">🤖</div>
          <div class="message-content">
            <p>안녕하세요! OpenCode Chat입니다.</p>
            <p>무엇을 도와드릴까요?</p>
          </div>
        </div>
      </div>`;

    // 탭 정보 표시
    if (tab.title) {
      tabTitle.textContent = tab.title;
      tabInfo.title = tab.url || '';
    }

    // 탭별 세션 조회/생성
    try {
      const result = await sendMessageToBackground('get-tab-session', {
        tabId: tab.id,
        title: tab.title || 'New Chat'
      });
      if (result.success) {
        currentSessionId = result.sessionId;
        if (result.isNew && tab.title) {
          addPageContextMessage(tab.title, tab.url);
        }
      }
    } catch (e) {
      console.error('세션 초기화 실패:', e);
    }
  }

  // 탭 전환 시 — 다른 탭이고 해당 탭에 세션이 있을 때만 갱신
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeInfo.tabId === currentTabId) return; // 같은 탭, 무시
    try {
      const response = await sendMessageToBackground('has-tab-session', { tabId: activeInfo.tabId });
      if (!response.has) return; // 이 탭에는 extension 없음
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await reinitForTab(tab);
    } catch (e) {}
  });

  // background의 action.onClicked에서 전송 — 새 탭에서 아이콘 클릭 시
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'reinit-for-tab') {
      chrome.tabs.get(message.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        reinitForTab(tab);
      });
    }
  });

  function addPageContextMessage(title, url) {
    const welcome = messagesContainer.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message bot-message';
    div.innerHTML = `
      <div class="message-avatar">🌐</div>
      <div class="message-content">
        <strong>${escapeHtml(title)}</strong><br>
        <small style="opacity:0.6;word-break:break-all">${escapeHtml(url)}</small><br><br>
        이 페이지에 대해 요약, 설명, 검색 등을 요청해보세요.
      </div>
    `;
    messagesContainer.insertBefore(div, messagesContainer.firstChild);
    scrollToBottom();
  }

  async function loadModels() {
    try {
      const result = await sendMessageToBackground('get-models');
      if (result.success && result.models) {
        availableModels = result.models;
        updateModelSelect();

        // 이전에 선택했던 모델 복원
        const { model } = await sendMessageToBackground('get-current-model');
        if (model) {
          for (const option of modelSelect.options) {
            if (!option.value) continue;
            try {
              const info = JSON.parse(option.value);
              if (info.providerId === model.providerID && info.modelName === model.modelID) {
                modelSelect.value = option.value;
                selectedModel = info;
                break;
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      console.error('모델 로드 실패:', error);
    }
  }

  function updateModelSelect() {
    modelSelect.innerHTML = '<option value="">모델 선택</option>';
    
    availableModels.forEach(provider => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = provider.name || provider.id;
      
      const models = Array.isArray(provider.models)
        ? provider.models
        : Object.entries(provider.models || {}).map(([id, m]) => ({ id, ...(typeof m === 'object' ? m : {}) }));

      models.forEach(model => {
        const option = document.createElement('option');
        option.value = JSON.stringify({
          providerId: provider.id,
          modelName: model.id || model.name
        });
        option.textContent = model.name || model.id;
        optgroup.appendChild(option);
      });
      
      modelSelect.appendChild(optgroup);
    });
  }

  modelSelect.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    
    const modelInfo = JSON.parse(e.target.value);
    selectedModel = modelInfo;
    
    try {
      await sendMessageToBackground('set-model', {
        providerId: modelInfo.providerId,
        modelName: modelInfo.modelName
      });
    } catch (error) {
      console.error('모델 변경 실패:', error);
    }
  });

  async function createNewSession() {
    try {
      const result = await sendMessageToBackground('create-session', {
        title: 'Chrome Extension Chat'
      });
      
      if (result.success) {
        currentSessionId = result.sessionId;
        console.log('세션 생성됨:', currentSessionId);
      }
    } catch (error) {
      console.error('세션 생성 실패:', error);
    }
  }

  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading || !currentSessionId) return;

    addUserMessage(message);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;

    isLoading = true;
    loadingIndicator.classList.remove('hidden');
    addTypingIndicator();

    try {
      await sendMessageToBackground('send-message', {
        sessionId: currentSessionId,
        message: message
      });
    } catch (error) {
      console.error('메시지 전송 실패:', error);
      removeTypingIndicator();
      addErrorMessage('메시지 전송에 실패했습니다.');
      isLoading = false;
      loadingIndicator.classList.add('hidden');
    }
  }

  function addUserMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.innerHTML = `
      <div class="message-avatar">👤</div>
      <div class="message-content">${escapeHtml(content)}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
  }

  function addBotMessage(content) {
    removeTypingIndicator();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    messageDiv.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-content">${escapeHtml(content)}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
  }

  function addTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot-message typing-indicator';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-content">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
    messagesContainer.appendChild(typingDiv);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
  }

  function addErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    messagesContainer.appendChild(errorDiv);
    scrollToBottom();
  }

  function updateConnectionStatus(status) {
    connectionStatus.className = 'connection-status ' + status;
    const statusText = connectionStatus.querySelector('.status-text');
    
    switch (status) {
      case 'connected':
        statusText.textContent = '연결됨';
        break;
      case 'connecting':
        statusText.textContent = '연결 중...';
        break;
      case 'disconnected':
        statusText.textContent = '연결 안됨';
        break;
      case 'error':
        statusText.textContent = '오류';
        break;
    }
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sendMessageToBackground(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response || {});
        }
      });
    });
  }

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !messageInput.value.trim();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  const settingsBtn = document.getElementById('settings-btn');
  settingsBtn.addEventListener('click', async () => {
    const current = (await sendMessageToBackground('get-working-directory')).directory || '';
    const dir = prompt('OpenCode 작업 디렉토리를 입력하세요.\n예: /home/user/myproject', current);
    if (dir !== null) {
      await sendMessageToBackground('set-working-directory', { directory: dir.trim() });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'message-chunk' && message.sessionId === currentSessionId) {
      const lastMessage = messagesContainer.querySelector('.bot-message:last-child');
      
      if (lastMessage && !lastMessage.classList.contains('typing-indicator')) {
        const contentDiv = lastMessage.querySelector('.message-content');
        contentDiv.textContent += message.chunk;
      } else {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
          const contentDiv = typingIndicator.querySelector('.message-content');
          contentDiv.textContent += message.chunk;
        } else {
          addBotMessage(message.chunk);
        }
      }
      scrollToBottom();
    } else if (message.action === 'message-complete' && message.sessionId === currentSessionId) {
      isLoading = false;
      loadingIndicator.classList.add('hidden');
      sendBtn.disabled = false;

      if (message.error) {
        removeTypingIndicator();
        addErrorMessage(message.error);
      } else {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
          const content = typingIndicator.querySelector('.message-content');
          if (content && content.textContent.trim()) {
            // 스트리밍 청크가 쌓인 경우 → 영구 메시지로 변환
            typingIndicator.classList.remove('typing-indicator');
            typingIndicator.removeAttribute('id');
          } else if (message.content && message.content.trim()) {
            // 청크를 못 받은 경우 → 최종 내용으로 표시
            content.textContent = message.content.trim();
            typingIndicator.classList.remove('typing-indicator');
            typingIndicator.removeAttribute('id');
          } else {
            typingIndicator.remove();
          }
        } else if (message.content && message.content.trim()) {
          addBotMessage(message.content.trim());
        }
      }
    }
  });

  init();
})();