const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function calcExtensionId(base64Key) {
  const der = Buffer.from(base64Key.trim(), 'base64');
  const hash = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return id;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const { version, key } = manifest;

if (!key) {
  console.error('ERROR: manifest.json에 key 필드가 없습니다.');
  console.error('       node scripts/set-webstore-key.js <base64-public-key> 를 먼저 실행하세요.');
  process.exit(1);
}

const extensionId = calcExtensionId(key);
console.log(`Version      : ${version}`);
console.log(`Extension ID : ${extensionId}`);

// native-host node_modules 준비 (번들용)
console.log('\nnative-host npm install...');
execSync('npm install', { cwd: path.join(ROOT, 'native-host'), stdio: 'inherit' });

// makensis 가용성 확인
try {
  execSync('makensis -VERSION', { stdio: 'pipe' });
} catch {
  console.error('\nERROR: makensis를 찾을 수 없습니다.');
  console.error('       sudo apt-get install nsis');
  process.exit(1);
}

const outExe = path.join(ROOT, `opencode-native-host-setup-v${version}.exe`);
const nsiScript = path.join(ROOT, 'installer', 'installer.nsi');

const cmd = [
  'makensis',
  `-DEXTENSION_ID=${extensionId}`,
  `-DAPP_VERSION=${version}`,
  `-DOUT_FILE=${outExe}`,
  `"${nsiScript}"`
].join(' ');

console.log(`\n${cmd}\n`);
execSync(cmd, { stdio: 'inherit', cwd: ROOT });
console.log(`\nInstaller: ${outExe}`);
