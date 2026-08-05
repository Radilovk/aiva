/**
 * SVG overlays — speech bubble + mini calendar/task grid (transparent background).
 * Composited on top of humanoid brand art for Package B.
 */

const C = {
  accent0: '#ff3b5c',
  accent1: '#ff7a93',
  accent2: '#ff9db0',
  success: '#2dd4a8',
};

/** Deterministic task dots (no random). */
function calendarBadge(x, y, w, h) {
  const headerH = h * 0.22;
  const cols = 4;
  const rows = 3;
  const cellW = (w - 8) / cols;
  const cellH = (h - headerH - 8) / rows;
  const taskColors = [C.success, C.accent1, C.accent0, C.success, C.accent1, C.accent0];
  const filled = [
    [0, 1], [0, 3], [1, 0], [1, 2], [2, 1], [2, 3], [0, 2], [1, 1],
  ];
  let dots = '';
  filled.forEach(([r, c], i) => {
    const dx = x + 4 + c * cellW + cellW * 0.35;
    const dy = y + headerH + 4 + r * cellH + cellH * 0.3;
    dots += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${(w * 0.04).toFixed(1)}" fill="${taskColors[i % taskColors.length]}" opacity="0.92"/>`;
  });
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(w * 0.12).toFixed(1)}" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="${headerH}" rx="${(w * 0.12).toFixed(1)}" fill="rgba(255,59,92,0.28)"/>
      ${dots}
    </g>`;
}

function speechBubble(x, y, w, h) {
  const tail = `M${x + w * 0.2} ${y + h} L${x + w * 0.12} ${y + h + h * 0.35} L${x + w * 0.38} ${y + h}`;
  const dotR = h * 0.09;
  const cy = y + h * 0.48;
  const d1 = x + w * 0.28;
  const d2 = x + w * 0.5;
  const d3 = x + w * 0.72;
  return `
    <g>
      <path d="M ${x + w * 0.15} ${y} H ${x + w * 0.85} Q ${x + w} ${y} ${x + w} ${y + h * 0.2} V ${y + h * 0.75} Q ${x + w} ${y + h} ${x + w * 0.85} ${y + h} ${tail} Z" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <circle cx="${d1}" cy="${cy}" r="${dotR}" fill="${C.accent2}" opacity="0.9"/>
      <circle cx="${d2}" cy="${cy}" r="${dotR}" fill="${C.accent1}" opacity="0.75"/>
      <circle cx="${d3}" cy="${cy}" r="${dotR}" fill="${C.accent0}" opacity="0.6"/>
    </g>`;
}

/** Icon-sized overlay (bubble + calendar on transparent canvas). */
export function iconOverlaySvg(size) {
  const calW = size * 0.34;
  const calH = size * 0.28;
  const calX = size * 0.54;
  const calY = size * 0.56;
  const bubW = size * 0.38;
  const bubH = size * 0.2;
  const bubX = size * 0.06;
  const bubY = size * 0.06;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${speechBubble(bubX, bubY, bubW, bubH)}
  ${calendarBadge(calX, calY, calW, calH)}
</svg>`;
}

/** Splash / portrait overlay — schedule card + bubble on humanoid splash. */
export function splashOverlaySvg(w, h) {
  const calW = w * 0.82;
  const calH = h * 0.2;
  const calX = (w - calW) / 2;
  const calY = h * 0.62;
  const bubW = w * 0.44;
  const bubH = h * 0.055;
  const bubX = w * 0.08;
  const bubY = h * 0.18;

  const taskRows = [0, 1, 2, 3].map((i) => {
    const y = calY + calH * 0.3 + (calH * 0.55) * (i / 3);
    const barW = calW * (0.32 + (i % 3) * 0.14);
    const color = i % 2 === 0 ? C.accent0 : C.success;
    return `<rect x="${(calX + calW * 0.08).toFixed(0)}" y="${y.toFixed(0)}" width="${barW.toFixed(0)}" height="${(calH * 0.055).toFixed(0)}" rx="5" fill="${color}" opacity="0.8"/>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${speechBubble(bubX, bubY, bubW, bubH)}
  <rect x="${calX}" y="${calY}" width="${calW}" height="${calH}" rx="20" fill="rgba(5,5,8,0.55)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
  <rect x="${calX}" y="${calY}" width="${calW}" height="${calH * 0.18}" rx="20" fill="rgba(255,59,92,0.35)"/>
  <text x="${calX + calW * 0.06}" y="${calY + calH * 0.13}" fill="rgba(255,255,255,0.85)" font-family="Inter,Arial,sans-serif" font-size="${w * 0.032}" font-weight="500">Today's schedule</text>
  ${taskRows}
</svg>`;
}
