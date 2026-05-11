const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

async function build() {
  const rootDir = path.resolve(__dirname, '..');
  const distDir = path.join(rootDir, 'dist');
  const version = require('../package.json').version;
  const zipName = `opencode-chrome-ext-v${version}.zip`;
  const zipPath = path.join(distDir, zipName);

  console.log('🚀 Building Chrome Extension...');
  console.log(`   Version: ${version}`);
  console.log(`   Output: ${distDir}`);

  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  const filesToCopy = [
    { src: 'manifest.json', dest: 'manifest.json' },
    { src: 'background.js', dest: 'background.js' },
    { src: 'sidepanel', dest: 'sidepanel' },
    { src: 'native-host', dest: 'native-host' },
    { src: '_locales', dest: '_locales' },
    { src: 'scripts/icons', dest: 'icons' }
  ];

  for (const file of filesToCopy) {
    const src = path.join(rootDir, file.src);
    const dest = path.join(distDir, file.dest);

    if (fs.existsSync(src)) {
      if (fs.statSync(src).isDirectory()) {
        copyDir(src, dest);
        console.log(`   ✓ Copied: ${file.dest}/`);
      } else {
        copyFile(src, dest);
        console.log(`   ✓ Copied: ${file.dest}`);
      }
    } else {
      console.log(`   ⚠ Missing: ${file.src}`);
    }
  }

  // manifest.json 버전을 package.json 버전으로 동기화
  const distManifestPath = path.join(distDir, 'manifest.json');
  if (fs.existsSync(distManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(distManifestPath, JSON.stringify(manifest, null, 2));
    console.log(`   ✓ manifest.json version synced: ${version}`);
  }

  try {
    const archiver = require('archiver');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`   ✓ Created: ${zipName} (${archive.pointer()} bytes)`);
        resolve();
      });
      archive.on('error', reject);
      
      archive.pipe(output);
      archive.directory(distDir, false);
      archive.finalize();
    });
  } catch (err) {
    console.log(`   ℹ archiver not installed, skipping zip (run: yarn add -D archiver)`);
  }

  console.log('\n✅ Build complete!');
  console.log(`   Extension files: ${distDir}`);
  console.log(`   Load in Chrome: chrome://extensions → "Load unpacked" → ${distDir}`);
}

build().catch(console.error);