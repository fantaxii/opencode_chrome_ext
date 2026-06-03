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
  const loadingIndicator = document.getElementById('loading-indicator');
  const attachBtn = document.getElementById('attach-btn');
  const inputArea = document.getElementById('input-area');
  const connectingIndicator = document.getElementById('connecting-indicator');
  const connectingMessage = document.getElementById('connecting-message');
  const connectingSpinner = document.getElementById('connecting-spinner');
  const retryBtn = document.getElementById('retry-btn');
  const commandDropdown = document.getElementById('command-dropdown');
  const agentBar = document.getElementById('agent-bar');
  const agentDot = document.getElementById('agent-dot');
  const agentNameEl = document.getElementById('agent-name');

  let currentSessionId = null;
  let currentTabId = null;
  let isLoading = false;
  let availableModels = [];
  let selectedModel = null;
  let commandCatalog = [
    { id: 'local.help',  slash: '/help',  title: 'Help',        description: '사용 가능한 커맨드 목록 표시', hasArg: false },
    { id: 'local.clear', slash: '/clear', title: 'Clear',       description: '채팅 히스토리 초기화',         hasArg: false },
    { id: 'local.model', slash: '/model', title: 'Model',       description: '모델 변경 <model-name>',       hasArg: true  },
    { id: 'local.wd',    slash: '/wd',    title: 'Working Dir', description: '작업 디렉토리 변경 <path>',    hasArg: true  },
  ];
  let isDropdownOpen = false;
  let selectedDropdownIndex = -1;
  let availableAgents = [];
  let currentAgentIndex = -1;

  async function init() {
    updateConnectionStatus('connecting');
    loadWorkingDirectory();

    try {
      const serverState = await sendMessageToBackground('init-server');

      if (serverState.success && serverState.available) {
        updateConnectionStatus('connected');
        await loadModels();
        await loadCommandCatalog();
        await loadAgents();
        if (!currentWorkingDir) await loadWorkingDirectory();
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
    const welcome = messagesContainer.querySelector('.welcome-section');
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

  async function loadCommandCatalog() {
    const localCommands = [
      { id: 'local.help',  slash: '/help',  title: 'Help',        description: '사용 가능한 커맨드 목록 표시',   hasArg: false },
      { id: 'local.clear', slash: '/clear', title: 'Clear',       description: '채팅 히스토리 초기화',           hasArg: false },
      { id: 'local.model', slash: '/model', title: 'Model',       description: '모델 변경 <model-name>',         hasArg: true  },
      { id: 'local.wd',    slash: '/wd',    title: 'Working Dir', description: '작업 디렉토리 변경 <path>',      hasArg: true  },
    ];
    try {
      const res = await sendMessageToBackground('get-commands', {});
      const serverCmds = (res.commands || []).map(c => ({
        id: 'server.' + c.name,
        slash: '/' + c.name,
        title: c.name,
        description: c.description || '',
        hasArg: Array.isArray(c.hints) && c.hints.includes('$ARGUMENTS'),
        template: c.template || ''
      }));
      const merged = [...localCommands];
      for (const sc of serverCmds) {
        if (!merged.find(lc => lc.slash === sc.slash)) merged.push(sc);
      }
      commandCatalog = merged;
    } catch {
      commandCatalog = localCommands;
    }
  }

  function showCommandDropdown(query) {
    const filtered = commandCatalog.filter(c =>
      c.slash.toLowerCase().startsWith(query.toLowerCase())
    );
    if (filtered.length === 0) { hideCommandDropdown(); return; }

    commandDropdown.innerHTML = filtered.map((c, i) => `
      <div class="command-item" data-index="${i}" data-slash="${escapeHtml(c.slash)}" data-has-arg="${c.hasArg}">
        <span class="command-name">${escapeHtml(c.slash)}</span>
        <span class="command-desc">${escapeHtml(c.description)}</span>
      </div>
    `).join('');

    commandDropdown.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('mousedown', e => { e.preventDefault(); selectCommand(item); });
    });

    commandDropdown.classList.remove('hidden');
    isDropdownOpen = true;
    selectedDropdownIndex = 0;
    highlightDropdownItem(0);
  }

  function hideCommandDropdown() {
    commandDropdown.classList.add('hidden');
    isDropdownOpen = false;
    selectedDropdownIndex = -1;
  }

  function highlightDropdownItem(index) {
    const items = commandDropdown.querySelectorAll('.command-item');
    items.forEach((item, i) => {
      item.classList.toggle('highlighted', i === index);
    });
    selectedDropdownIndex = index;
    if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
  }

  function selectCommand(item) {
    const slash = item.dataset.slash;
    const hasArg = item.dataset.hasArg === 'true';
    hideCommandDropdown();
    messageInput.focus();
    if (hasArg) {
      messageInput.value = slash + ' ';
      messageInput.dispatchEvent(new Event('input'));
    } else {
      messageInput.value = slash;
      sendMessage();
    }
  }

  function findModelByName(query) {
    const q = query.toLowerCase().trim();
    for (const provider of availableModels) {
      const models = Array.isArray(provider.models)
        ? provider.models
        : Object.entries(provider.models || {}).map(([id, m]) => ({ id, ...(typeof m === 'object' ? m : {}) }));
      for (const m of models) {
        const name = (m.name || '').toLowerCase();
        const id = (m.id || '').toLowerCase();
        if (name === q || id === q || id.includes(q) || name.includes(q)) {
          return { providerID: provider.id, modelID: m.id || m.name };
        }
      }
    }
    return null;
  }

  async function loadAgents() {
    try {
      const res = await sendMessageToBackground('get-agents');
      availableAgents = res.agents || [];
      if (availableAgents.length > 0) {
        currentAgentIndex = 0;
        updateAgentBar();
      }
    } catch {}
  }

  function updateAgentBar() {
    const agent = availableAgents[currentAgentIndex];
    if (!agent) {
      agentDot.style.color = 'var(--text-secondary)';
      agentNameEl.textContent = '에이전트';
      return;
    }
    const fullName = agent.name.replace(/[​-‍﻿]/g, '').trim();
    agentDot.style.color = agent.color || 'var(--text-secondary)';
    agentNameEl.textContent = fullName;
  }

  async function cycleAgent() {
    if (!availableAgents.length) return;
    currentAgentIndex = (currentAgentIndex + 1) % availableAgents.length;
    updateAgentBar();
    if (!currentSessionId) return;
    try {
      await sendMessageToBackground('set-agent', {
        sessionId: currentSessionId,
        agentName: availableAgents[currentAgentIndex].name
      });
    } catch (e) {
      console.error('에이전트 변경 실패:', e);
    }
  }

  agentBar.addEventListener('click', () => cycleAgent());

  function showModelPicker() {
    removeTypingIndicator();
    if (!availableModels.length) {
      addBotMessage('모델 목록을 불러오지 못했습니다. 서버 연결 상태를 확인하세요.');
      return;
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';

    const picker = document.createElement('div');
    picker.className = 'model-picker';

    const title = document.createElement('p');
    title.className = 'model-picker-title';
    title.textContent = '모델을 선택하세요:';
    picker.appendChild(title);

    availableModels.forEach(provider => {
      const models = Array.isArray(provider.models)
        ? provider.models
        : Object.entries(provider.models || {}).map(([id, m]) => ({ id, ...(typeof m === 'object' ? m : {}) }));
      if (!models.length) return;

      const group = document.createElement('div');
      group.className = 'model-picker-group';

      const providerLabel = document.createElement('span');
      providerLabel.className = 'model-picker-provider';
      providerLabel.textContent = provider.name || provider.id;
      group.appendChild(providerLabel);

      models.forEach(model => {
        const providerId = provider.id;
        const modelId = model.id || model.name;
        const modelName = model.name || model.id;
        const isCurrent = selectedModel &&
          selectedModel.providerId === providerId &&
          selectedModel.modelName === modelId;

        const btn = document.createElement('button');
        btn.className = 'model-picker-btn' + (isCurrent ? ' current' : '');
        btn.textContent = modelName + (isCurrent ? ' ✓' : '');
        btn.dataset.provider = providerId;
        btn.dataset.model = modelId;
        btn.dataset.name = modelName;

        btn.addEventListener('click', async () => {
          try {
            await sendMessageToBackground('set-model', { providerId, modelName: modelId });
            selectedModel = { providerId, modelName: modelId };
            for (const option of modelSelect.options) {
              if (!option.value) continue;
              try {
                const info = JSON.parse(option.value);
                if (info.providerId === providerId && info.modelName === modelId) {
                  modelSelect.value = option.value;
                  break;
                }
              } catch {}
            }
            messageDiv.remove();
            addBotMessage(`모델이 변경되었습니다: ${modelName}`);
          } catch (e) {
            addErrorMessage(`모델 변경 실패: ${e.message}`);
          }
        });

        group.appendChild(btn);
      });

      picker.appendChild(group);
    });

    content.appendChild(picker);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
  }

  async function executeCommand(input) {
    const parts = input.trim().split(/\s+/);
    const slash = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    addUserMessage(input);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    hideCommandDropdown();

    if (slash === '/help') {
      const lines = commandCatalog.map(c => `${c.slash.padEnd(12)} ${c.description}`).join('\n');
      addBotMessage('사용 가능한 커맨드:\n\n' + lines);
      sendBtn.disabled = false;
      return;
    }

    if (slash === '/clear') {
      messagesContainer.innerHTML = '';
      try {
        const result = await sendMessageToBackground('create-session', { title: 'Chrome Extension Chat' });
        if (result.success) currentSessionId = result.sessionId;
        else currentSessionId = null;
      } catch {
        currentSessionId = null;
        addErrorMessage('세션 재생성에 실패했습니다.');
      }
      addBotMessage('채팅이 초기화되었습니다.');
      sendBtn.disabled = false;
      return;
    }

    if (slash === '/model') {
      if (!args) { showModelPicker(); sendBtn.disabled = false; return; }
      const found = findModelByName(args);
      if (!found) { addBotMessage(`모델을 찾을 수 없습니다: ${args}`); sendBtn.disabled = false; return; }
      try {
        await sendMessageToBackground('set-model', { providerId: found.providerID, modelName: found.modelID });
        addBotMessage(`모델이 변경되었습니다: ${found.modelID}`);
        for (const option of modelSelect.options) {
          if (!option.value) continue;
          try {
            const info = JSON.parse(option.value);
            if (info.providerId === found.providerID && info.modelName === found.modelID) {
              modelSelect.value = option.value;
              selectedModel = info;
              break;
            }
          } catch {}
        }
      } catch (e) {
        addErrorMessage(`모델 변경 실패: ${e.message}`);
      } finally {
        sendBtn.disabled = false;
      }
      return;
    }

    if (slash === '/wd') {
      if (!args) { addBotMessage('사용법: /wd <path>'); sendBtn.disabled = false; return; }
      try {
        const result = await sendMessageToBackground('set-working-directory', { directory: args });
        updateWorkingFolderDisplay(result.directory || args);
        addBotMessage(`작업 디렉토리가 변경되었습니다: ${result.directory || args}`);
      } catch (e) {
        addErrorMessage(`디렉토리 변경 실패: ${e.message}`);
      } finally {
        sendBtn.disabled = false;
      }
      return;
    }

    const cmd = commandCatalog.find(c => c.slash === slash && !c.id.startsWith('local.'));
    if (cmd) {
      let promptText = cmd.template || slash;
      if (args) promptText = promptText.replace(/\$ARGUMENTS/g, args);
      setLoadingState(true);
      addTypingIndicator();
      try {
        await sendMessageToBackground('send-message', { sessionId: currentSessionId, message: promptText });
      } catch (error) {
        removeTypingIndicator();
        addErrorMessage(`커맨드 실행 실패: ${error.message}`);
        setLoadingState(false);
      }
      return;
    }

    // 미인식 커맨드 → AI에 그대로 전달
    setLoadingState(true);
    addTypingIndicator();
    try {
      await sendMessageToBackground('send-message', { sessionId: currentSessionId, message: input });
    } catch (error) {
      removeTypingIndicator();
      addErrorMessage('메시지 전송에 실패했습니다.');
      setLoadingState(false);
    }
  }

  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading || !currentSessionId) return;

    if (message.startsWith('/')) {
      await executeCommand(message);
      return;
    }

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

    const val = messageInput.value;
    if (val.startsWith('/') && !val.includes(' ')) {
      showCommandDropdown(val);
    } else {
      hideCommandDropdown();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      cycleAgent();
    }
  });

  messageInput.addEventListener('keydown', (e) => {
    if (isDropdownOpen) {
      const items = commandDropdown.querySelectorAll('.command-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightDropdownItem(Math.min(selectedDropdownIndex + 1, items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightDropdownItem(Math.max(selectedDropdownIndex - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedDropdownIndex >= 0 && items[selectedDropdownIndex]) {
          selectCommand(items[selectedDropdownIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideCommandDropdown();
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const target = items[selectedDropdownIndex] || items[0];
        if (target) selectCommand(target);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener('blur', () => {
    setTimeout(hideCommandDropdown, 150);
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
    } else if (message.action === 'default-directory-updated' && !currentWorkingDir) {
      defaultWorkingDir = message.directory;
      updateWorkingFolderDisplay(message.directory, true);
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