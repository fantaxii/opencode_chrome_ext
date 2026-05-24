const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let opencodeProcess = null;
let currentPort = 4096;
let isWSL = false; // WSL 사용 여부 추적

function log(message) {
  process.stderr.write(`[OpenCode-Native-Host] ${message}\n`);
}

async function checkOpenCodeServer(port) {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/global/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

async function findAvailablePort(startPort = 4096) {
  for (let port = startPort; port < startPort + 10; port++) {
    const available = await checkOpenCodeServer(port);
    if (!available) {
      return port;
    }
  }
  return null;
}

// Windows PATH 및 WSL에서 opencode 경로를 찾는 함수
async function findOpenCodePath() {
  console.error('[DEBUG] findOpenCodePath() called - Starting path detection...');

  // 1순위: Windows PATH에서 탐색
  try {
    console.error('[DEBUG] Attempting to find opencode in Windows PATH...');
    const windowsPath = require('which').sync('opencode');
    console.error(`[DEBUG] Found opencode in Windows PATH: ${windowsPath}`);
    return { path: windowsPath, isWSL: false };
  } catch (error) {
    console.error('[DEBUG] opencode not found in Windows PATH:', error.message);
  }

  // 2순위: WSL에서 탐색 (spawnSync로 cmd.exe 우회 → interactive login shell로 ~/.bashrc 로드)
  try {
    console.error('[DEBUG] Attempting to find opencode in WSL...');
    const result = spawnSync('wsl.exe', ['bash', '-ilc', 'which opencode 2>/dev/null'], {
      encoding: 'utf8',
      timeout: 10000
    });
    const wslPath = (result.stdout || '').trim();
    console.error(`[DEBUG] WSL returned path: "${wslPath}", stderr: "${(result.stderr || '').trim()}"`);

    if (wslPath) {
      console.error('[DEBUG] Found opencode in WSL');
      return { path: wslPath, isWSL: true };
    } else {
      console.error('[DEBUG] WSL opencode not found');
    }
  } catch (error) {
    console.error('[DEBUG] WSL search failed:', error.message);
  }

  console.error('[DEBUG] opencode not found in Windows or WSL');
  return null;
}

async function startOpenCodeServer(preferredPort = 4096) {
  if (opencodeProcess) {
    log('OpenCode 프로세스가 이미 실행 중');
    return currentPort;
  }

  log('OpenCode 서버 시작 시도...');

  try {
    const port = await findAvailablePort(preferredPort);
    
    if (!port) {
      throw new Error('사용 가능한 포트를 찾을 수 없음');
    }

    currentPort = port;
    
    // opencode 경로 탐지 (Windows → WSL fallback)
    console.error('[DEBUG] startOpenCodeServer: Calling findOpenCodePath()...');
    const found = await findOpenCodePath();
    console.error('[DEBUG] startOpenCodeServer: findOpenCodePath() result:', found);

    if (!found) {
      throw new Error('opencode를 찾을 수 없음 (Windows/WSL 모두 확인)');
    }

    // WSL 사용 여부 설정
    isWSL = found.isWSL;
    console.error(`[DEBUG] isWSL flag set to: ${isWSL}`);

    if (isWSL) {
      // WSL 방식으로 실행 - 찾은 전체 경로로 직접 실행 (bash 우회, TTY 문제 없음)
      console.error(`[DEBUG] Spawning opencode in WSL with full path: ${found.path}`);
      log(`WSL에서 OpenCode 서버 시작 (포트 ${port})...`);
      opencodeProcess = spawn('wsl.exe', [found.path, 'serve', '--port', port.toString()], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } else {
      // Windows 방식 (기존)
      console.error('[DEBUG] Spawning opencode in Windows...');
      log(`Windows에서 OpenCode 서버 시작 (포트 ${port})...`);
      opencodeProcess = spawn(found.path, ['serve', '--port', port.toString()], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    opencodeProcess.stdout.on('data', (data) => {
      log(data.toString());
    });

    opencodeProcess.stderr.on('data', (data) => {
      log(data.toString());
    });

    opencodeProcess.on('exit', (code) => {
      log(`OpenCode 프로세스 종료: ${code}`);
      opencodeProcess = null;
    });

    opencodeProcess.on('error', (error) => {
      log(`OpenCode 프로세스 오류: ${error.message}`);
      opencodeProcess = null;
    });

    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const available = await checkOpenCodeServer(port);
      if (available) {
        log(`OpenCode 서버 시작 완료: 포트 ${port}`);
        return port;
      }
      attempts++;
    }

    throw new Error('서버 시작 시간 초과');
  } catch (error) {
    log(`서버 시작 실패: ${error.message}`);
    throw error;
  }
}

function stopOpenCodeServer() {
  if (opencodeProcess) {
    console.error('[DEBUG] stopOpenCodeServer called. isWSL:', isWSL);
    opencodeProcess.kill();
    opencodeProcess = null;
    log('OpenCode 서버 종료');

    // WSL인 경우 WSL 내부의 opencode 프로세스 추가 종료
    if (isWSL) {
      console.error('[DEBUG] Attempting to kill WSL opencode process...');
      try {
        // WSL 내부의 opencode 프로세스 PID 찾기 및 종료
        execSync('wsl.exe pkill -f "opencode serve"', { encoding: 'utf8' });
        log('WSL 내부 OpenCode 프로세스 종료');
        console.error('[DEBUG] WSL opencode process killed successfully');
      } catch (error) {
        // pkill이 프로세스를 찾지 못해도 에러로 처리하지 않음 (이미 종료되었을 수 있음)
        console.error('[DEBUG] pkill failed (process may already be dead):', error.message);
      }
    }

    // 플래그 초기화
    isWSL = false;
    console.error('[DEBUG] isWSL flag reset to false');
  }
}

async function handleMessage(message) {
  const { action, preferredPort } = message;

  switch (action) {
    case 'start':
      try {
        const port = await startOpenCodeServer(preferredPort || 4096);
        return { status: 'success', port };
      } catch (error) {
        return { status: 'error', error: error.message };
      }

    case 'stop':
      stopOpenCodeServer();
      return { status: 'success' };

    case 'status':
      const available = await checkOpenCodeServer(currentPort);
      return {
        status: 'success',
        running: available,
        port: currentPort
      };

    case 'check-port':
      const portAvailable = await findAvailablePort(preferredPort || 4096);
      return { port: portAvailable };

    default:
      return { status: 'error', error: 'Unknown action' };
  }
}

function readMessage() {
  return new Promise((resolve, reject) => {
    let headerBuf = Buffer.alloc(4);
    let headerBytes = 0;
    let msgBuf = null;
    let msgBytes = 0;

    const onData = (chunk) => {
      let offset = 0;

      // 4바이트 길이 헤더 읽기
      while (offset < chunk.length && headerBytes < 4) {
        headerBuf[headerBytes++] = chunk[offset++];
      }
      if (headerBytes < 4) return;

      // 헤더 완성 후 메시지 버퍼 할당 (1회)
      if (!msgBuf) {
        const length = headerBuf.readUInt32LE(0);
        if (length > 1024 * 1024) {
          process.stdin.removeListener('data', onData);
          return reject(new Error('메시지 너무 큼'));
        }
        msgBuf = Buffer.alloc(length);
      }

      // 메시지 바디 읽기 (헤더와 같은 chunk에 있어도 처리)
      while (offset < chunk.length && msgBytes < msgBuf.length) {
        msgBuf[msgBytes++] = chunk[offset++];
      }

      if (msgBytes === msgBuf.length) {
        process.stdin.removeListener('data', onData);
        try {
          resolve(JSON.parse(msgBuf.toString('utf8')));
        } catch {
          reject(new Error('잘못된 JSON'));
        }
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

function writeMessage(message) {
  const jsonString = JSON.stringify(message);
  const jsonBuffer = Buffer.from(jsonString, 'utf8');
  
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(jsonBuffer.length, 0);
  
  const stdout = process.stdout;
  stdout.write(lengthBuffer);
  stdout.write(jsonBuffer);
}

async function main() {
  log('Native Messaging Host 시작');

  while (true) {
    try {
      const message = await readMessage();
      const response = await handleMessage(message);
      writeMessage(response);
    } catch (error) {
      log(`오류: ${error.message}`);
      writeMessage({ status: 'error', error: error.message });
    }
  }
}

main();