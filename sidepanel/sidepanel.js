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
        await createNewSession();
      } else {
        updateConnectionStatus('disconnected');
      }
    } catch (error) {
      console.error('초기화 실패:', error);
      updateConnectionStatus('error');
    }

    const tabInfoData = await sendMessageToBackground('get-tab-info');
    if (tabInfoData && tabInfoData.title) {
      tabTitle.textContent = tabInfoData.title;
      tabInfo.title = tabInfoData.url;
    }
  }

  async function loadModels() {
    try {
      const result = await sendMessageToBackground('get-models');
      if (result.success && result.models) {
        availableModels = result.models;
        updateModelSelect();
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