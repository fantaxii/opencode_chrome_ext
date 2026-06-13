const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const publicKey = process.argv[2];
if (!publicKey) {
  console.error('Usage: node scripts/set-webstore-key.js <base64-public-key>');
  console.error('');
  console.error('Web Store 개발자 대시보드에서 공개키를 복사해서 인수로 전달하세요.');
  process.exit(1);
}

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

const key = publicKey.trim();
const extensionId = calcExtensionId(key);

const manifestPath = path.resolve(__dirname, '../manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const oldKey = manifest.key ? `${manifest.key.substring(0, 20)}...` : '(없음)';
manifest.key = key;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`Extension ID : ${extensionId}`);
console.log(`이전 key     : ${oldKey}`);
console.log(`새 key       : ${key.substring(0, 20)}...`);
console.log('');
console.log('manifest.json key 업데이트 완료. yarn build:all로 재빌드하세요.');
