const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];

function createIcon(size) {
  const png = new PNG({ width: size, height: size });

  const bgColor = { r: 59, g: 130, b: 246 }; // Blue background
  const textColor = { r: 255, g: 255, b: 255 }; // White text

  // Fill background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      png.data[idx] = bgColor.r;
      png.data[idx + 1] = bgColor.g;
      png.data[idx + 2] = bgColor.b;
      png.data[idx + 3] = 255;
    }
  }

  // Draw "OC" text (simple rectangle representation)
  const padding = Math.floor(size * 0.15);
  const fontSize = Math.floor(size * 0.35);
  
  // Draw O
  const oStart = padding;
  const oEnd = padding + fontSize;
  const centerY = Math.floor(size / 2);
  const thickness = Math.max(2, Math.floor(size * 0.08));

  for (let y = oStart; y < oEnd; y++) {
    for (let x = oStart; x < oEnd; x++) {
      const idx = (size * y + x) << 2;
      const inOuter = y < oStart + thickness || y >= oEnd - thickness || 
                      x < oStart + thickness || x >= oEnd - thickness;
      const inInner = y >= oStart + thickness * 2 && y < oEnd - thickness * 2 &&
                      x >= oStart + thickness * 2 && x < oEnd - thickness * 2;
      if (inOuter && !inInner) {
        png.data[idx] = textColor.r;
        png.data[idx + 1] = textColor.g;
        png.data[idx + 2] = textColor.b;
        png.data[idx + 3] = 255;
      }
    }
  }

  // Draw C
  const cStart = oEnd + Math.floor(size * 0.1);
  const cEnd = cStart + fontSize;
  
  for (let y = cStart - Math.floor(size * 0.1); y < cEnd + Math.floor(size * 0.1); y++) {
    if (y < 0 || y >= size) continue;
    for (let x = cStart; x < cEnd; x++) {
      if (x < 0 || x >= size) continue;
      const idx = (size * y + x) << 2;
      const isTop = y >= cStart - Math.floor(size * 0.1) && y < cStart + thickness;
      const isBottom = y >= cEnd - thickness && y < cEnd + Math.floor(size * 0.1);
      const isLeft = x >= cStart && x < cStart + thickness;
      if ((isTop || isBottom || isLeft) && !(y >= cStart + thickness * 2 && y < cEnd - thickness * 2 && x >= cStart + thickness * 2)) {
        png.data[idx] = textColor.r;
        png.data[idx + 1] = textColor.g;
        png.data[idx + 2] = textColor.b;
        png.data[idx + 3] = 255;
      }
    }
  }

  return png;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

sizes.forEach(size => {
  const png = createIcon(size);
  const filename = `icon${size}.png`;
  const filepath = path.join(iconsDir, filename);
  fs.writeFileSync(filepath, PNG.sync.write(png));
  console.log(`Created: ${filename}`);
});

console.log('All icons created successfully!');