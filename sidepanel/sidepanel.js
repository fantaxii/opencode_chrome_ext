(function() {
  const messagesContainer = document.getElementById('messages-container');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const modelSelect = document.getElementById('model-select');
  const workingFolderWrapper = document.getElementById('working-folder-wrapper');
  const folderIcon = document.getElementById('folder-icon');
  const workingFolderDisplay = document.getElementById('working-folder-display');
  const workingFolderInput = document.getElementById('working-folder-input');
  const workingFolderEditBtn = document.getElementById('working-folder-edit-btn');
  let currentWorkingDir = '';
  let defaultWorkingDir = '';
  const header = document.querySelector('.header');
  const connectionText = document.getElementById('connection-text');
  const pageTitle = document.getElementById('page-title');
  const pageUrl = document.getElementById('page-url');
  const loadingIndicator = document.getElementById('loading-indicator');
  const attachBtn = document.getElementById('attach-btn');
  const inputArea = document.getElementById('input-area');
  const connectingIndicator = document.getElementById('connecting-indicator');
  const connectingMessage = document.getElementById('connecting-message');
  const connectingSpinner = document.getElementById('connecting-spinner');
  const retryBtn = document.getElementById('retry-btn');

  let currentSessionId = null;
  let currentTabId = null;
  let isLoading = false;
  let availableModels = [];
  let selectedModel = null;

  async function init() {
    updateConnectionStatus('connecting');
    loadWorkingDirectory();

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

  async function loadWorkingDirectory() {
    try {
      const result = await sendMessageToBackground('get-working-directory');
      if (result.directory) {
        updateWorkingFolderDisplay(result.directory);
      } else {
        const def = await sendMessageToBackground('get-default-directory');
        defaultWorkingDir = def.directory || '';
        updateWorkingFolderDisplay(defaultWorkingDir, true);
      }
    } catch (e) {}
  }

  function updateWorkingFolderDisplay(dir, isDefault = false) {
    if (!isDefault) currentWorkingDir = dir;
    if (!dir) {
      workingFolderDisplay.textContent = '폴더 없음';
      workingFolderWrapper.title = '';
      workingFolderDisplay.classList.remove('default');
      return;
    }
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean);
    const short = parts.length > 2 ? '…/' + parts.slice(-2).join('/') : dir;
    workingFolderDisplay.textContent = short;
    workingFolderWrapper.title = isDefault ? `기본값: ${dir}` : dir;
    workingFolderDisplay.classList.toggle('default', isDefault);
  }

  function enterEditMode() {
    workingFolderInput.value = currentWorkingDir || defaultWorkingDir;
    folderIcon.classList.add('hidden');
    workingFolderDisplay.classList.add('hidden');
    workingFolderEditBtn.classList.add('hidden');
    workingFolderInput.classList.remove('hidden');
    workingFolderInput.focus();
    workingFolderInput.select();
  }

  function exitEditMode() {
    workingFolderInput.classList.add('hidden');
    folderIcon.classList.remove('hidden');
    workingFolderDisplay.classList.remove('hidden');
    workingFolderEditBtn.classList.remove('hidden');
  }

  workingFolderEditBtn.addEventListener('click', enterEditMode);

  async function commitWorkingFolder() {
    const newPath = workingFolderInput.value.trim();
    exitEditMode();
    if (newPath !== currentWorkingDir) {
      const result = await sendMessageToBackground('set-working-directory', { directory: newPath });
      updateWorkingFolderDisplay(result.directory || newPath);
    }
  }

  workingFolderInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); await commitWorkingFolder(); }
    if (e.key === 'Escape') { exitEditMode(); }
  });

  workingFolderInput.addEventListener('blur', commitWorkingFolder);

  async function reinitForTab(tab) {
    currentTabId = tab.id;
    currentSessionId = null;
    isLoading = false;
    loadingIndicator.classList.add('hidden');
    sendBtn.disabled = !messageInput.value.trim();

    if (tab.title) {
      pageTitle.textContent = tab.title;
      pageUrl.textContent = tab.url || '';
    }

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

    try {
      const { pendingContextText } = await chrome.storage.local.get('pendingContextText');
      if (pendingContextText?.tabId === tab.id && pendingContextText?.text) {
        await chrome.storage.local.remove('pendingContextText');
        messageInput.value = pendingContextText.text;
        messageInput.dispatchEvent(new Event('input'));
        messageInput.focus();
        messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
      }
    } catch (e) {
      console.error('pendingContextText 처리 실패:', e);
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
      console.log('[loadModels] get-models result:', result);
      if (result.success && result.models) {
        availableModels = result.models;
        updateModelSelect();

        const { model } = await sendMessageToBackground('get-current-model');
        console.log('[loadModels] get-current-model result:', model);
        if (model) {
          for (const option of modelSelect.options) {
            if (!option.value) continue;
            try {
              const info = JSON.parse(option.value);
              if (info.providerId === model.providerID && info.modelName === model.modelID) {
                modelSelect.value = option.value;
                selectedModel = info;
                console.log('[loadModels] model selected:', modelSelect.value);
                break;
              }
            } catch {}
          }
        } else {
          console.log('[loadModels] no model found in storage');
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
    setLoadingState(true);
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
      setLoadingState(false);
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
    header.classList.remove('connected', 'connecting');
    inputArea.classList.remove('disabled');
    connectingIndicator.classList.add('hidden');
    connectingSpinner.classList.remove('hidden');
    retryBtn.classList.add('hidden');

    switch (status) {
      case 'connected':
        header.classList.add('connected');
        connectionText.textContent = '연결됨';
        break;
      case 'connecting':
        header.classList.add('connecting');
        connectionText.textContent = '연결 중...';
        inputArea.classList.add('disabled');
        connectingMessage.textContent = 'OpenCode server connecting...';
        connectingIndicator.classList.remove('hidden');
        break;
      case 'disconnected':
        connectionText.textContent = '연결 안됨';
        inputArea.classList.add('disabled');
        connectingMessage.textContent = '서버 연결에 실패했습니다';
        connectingSpinner.classList.add('hidden');
        retryBtn.classList.remove('hidden');
        connectingIndicator.classList.remove('hidden');
        break;
      case 'error':
        connectionText.textContent = '오류';
        inputArea.classList.add('disabled');
        connectingMessage.textContent = '연결 오류가 발생했습니다';
        connectingSpinner.classList.add('hidden');
        retryBtn.classList.remove('hidden');
        connectingIndicator.classList.remove('hidden');
        break;
    }
  }

  retryBtn.addEventListener('click', () => {
    init();
  });

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

  function setLoadingState(loading) {
    isLoading = loading;
    if (loading) {
      sendBtn.disabled = false;
      sendBtn.textContent = '■';
      sendBtn.classList.add('cancel-mode');
      loadingIndicator.classList.remove('hidden');
    } else {
      sendBtn.textContent = '↑';
      sendBtn.classList.remove('cancel-mode');
      sendBtn.disabled = !messageInput.value.trim();
      loadingIndicator.classList.add('hidden');
    }
  }

  async function cancelMessage() {
    if (!isLoading || !currentSessionId) return;
    await sendMessageToBackground('cancel-message', { sessionId: currentSessionId });
    removeTypingIndicator();
    setLoadingState(false);
  }

  sendBtn.addEventListener('click', () => {
    if (isLoading) cancelMessage();
    else sendMessage();
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
      setLoadingState(false);

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