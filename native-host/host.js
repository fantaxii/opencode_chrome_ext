const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let opencodeProcess = null;
let currentPort = 4096;

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
    
    const opencodePath = require('which').sync('opencode');
    
    opencodeProcess = spawn(opencodePath, ['serve', '--port', port.toString()], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

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
    opencodeProcess.kill();
    opencodeProcess = null;
    log('OpenCode 서버 종료');
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
  let lengthBuffer = Buffer.alloc(4);
  let bytesRead = 0;

  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        if (bytesRead < 4) {
          lengthBuffer[bytesRead] = chunk[i];
          bytesRead++;

          if (bytesRead === 4) {
            const length = lengthBuffer.readUInt32LE(0);
            
            if (length > 1024 * 1024) {
              reject(new Error('메시지 너무 큼'));
              return;
            }

            let messageBuffer = Buffer.alloc(length);
            let messageBytesRead = 0;

            const readMessageChunk = (msgChunk) => {
              for (let j = 0; j < msgChunk.length; j++) {
                if (messageBytesRead < length) {
                  messageBuffer[messageBytesRead] = msgChunk[j];
                  messageBytesRead++;

                  if (messageBytesRead === length) {
                    process.stdin.removeListener('data', readMessageChunk);
                    try {
                      const message = JSON.parse(messageBuffer.toString('utf8'));
                      resolve(message);
                    } catch (e) {
                      reject(new Error('잘못된 JSON'));
                    }
                  }
                }
              }
            };

            process.stdin.on('data', readMessageChunk);
          }
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
  stdout.flush();
}

async function main() {
  log('Native Messaging Host 시작');

  process.stdin.setEncoding('utf8');

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