const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

function generateIcon(size) {
  const png = new PNG({ width: size, height: size });

  for (let i = 0; i < size * size * 4; i += 4) {
    png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 0;
  }

  function blend(x, y, r, g, b, alpha) {
    if (x < 0 || x >= size || y < 0 || y >= size || alpha <= 0) return;
    const i = (y * size + x) * 4;
    const a = alpha / 255;
    const da = png.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa < 0.001) return;
    png.data[i]     = Math.round((r * a + png.data[i]     * da * (1 - a)) / oa);
    png.data[i + 1] = Math.round((g * a + png.data[i + 1] * da * (1 - a)) / oa);
    png.data[i + 2] = Math.round((b * a + png.data[i + 2] * da * (1 - a)) / oa);
    png.data[i + 3] = Math.round(oa * 255);
  }

  // 둥근 배경 그라디언트 (#2563EB → #1E3A8A)
  const radius = Math.round(size * 0.20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = Math.max(radius, Math.min(size - 1 - radius, x));
      const ny = Math.max(radius, Math.min(size - 1 - radius, y));
      const dist = Math.sqrt((x - nx) ** 2 + (y - ny) ** 2);
      const aa = Math.min(1, Math.max(0, radius - dist + 0.5));
      if (aa <= 0) continue;

      const t = y / (size - 1);
      const cr = Math.round(37  + (30  - 37)  * t);
      const cg = Math.round(99  + (58  - 99)  * t);
      const cb = Math.round(235 + (138 - 235) * t);
      blend(x, y, cr, cg, cb, Math.round(aa * 255));
    }
  }

  // 두꺼운 선 그리기 (안티앨리어싱)
  function drawLine(x0, y0, x1, y1, thick, r, g, b) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const steps = Math.ceil(len * 3);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      for (let w = -thick; w <= thick; w += 0.4) {
        const qx = Math.round(px + nx * w);
        const qy = Math.round(py + ny * w);
        const aa = Math.min(1, Math.max(0, thick - Math.abs(w) + 0.5));
        blend(qx, qy, r, g, b, Math.round(aa * 255));
      }
    }
  }

  // 심볼: >_ (터미널 프롬프트), 크기에 비례
  const s = size / 128;
  const thick = Math.max(1.5, 5.5 * s);

  // ">" 문자 — 왼쪽 영역 중앙
  const gx = Math.round(30 * s);
  const gy = Math.round(64 * s);
  const gh = Math.round(21 * s);
  const gw = Math.round(15 * s);
  drawLine(gx,      gy - gh, gx + gw, gy,      thick, 255, 255, 255);
  drawLine(gx + gw, gy,      gx,      gy + gh, thick, 255, 255, 255);

  // "_" 문자 — 오른쪽 영역 하단
  const ux  = Math.round(82 * s);
  const uy  = Math.round(80 * s);
  const uhw = Math.round(20 * s);
  drawLine(ux - uhw / 2, uy, ux + uhw / 2, uy, thick, 255, 255, 255);

  return png;
}

const sizes = [16, 32, 48, 128];
const outDir = path.resolve(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of sizes) {
  const png = generateIcon(size);
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log(`✓ icon${size}.png`);
}
console.log('Done.');
