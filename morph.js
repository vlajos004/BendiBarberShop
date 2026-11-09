// Átalakuló borbélyeszközök (mint a régi Paint "morph"): minden körvonalat ugyanannyi pontra mintavételezünk,
// és pontonként átúsztatjuk egyiket a másikba.
const N = 180;
const comb = (() => {
  let d = 'M24 58 Q24 50 32 50 L168 50 Q176 50 176 58 L176 84';
  for (let x = 170; x > 30; x -= 18) d += ` L${x} 84 L${x} 150 Q${x} 156 ${x - 5} 156 L${x - 7} 156 Q${x - 12} 156 ${x - 12} 150 L${x - 12} 84`;
  return d + ' L24 84 Z';
})();
export const SHAPES = [
  ['hajszárító', 'M28 82 A52 52 0 0 1 118 46 L172 50 Q184 51 184 63 L184 95 Q184 107 172 108 L120 112 Q112 124 100 130 L108 178 Q110 190 98 190 L80 190 Q70 190 69 180 L62 134 A52 52 0 0 1 28 82 Z'],
  ['hajwax', 'M40 52 Q40 42 50 42 L150 42 Q160 42 160 52 L160 74 Q160 82 152 82 L152 150 Q152 172 130 172 L70 172 Q48 172 48 150 L48 82 Q40 82 40 74 Z'],
  ['hajvágógép', 'M62 36 L70 20 L78 34 L86 20 L94 34 L102 20 L110 34 L118 20 L126 34 L134 20 L140 36 L140 50 L132 58 L136 168 Q136 188 116 188 L84 188 Q64 188 64 168 L68 58 L62 50 Z'],
  ['fésű', comb]
];

function sample(d, svg){
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); svg.appendChild(p);
  const L = p.getTotalLength(), pts = [];
  for (let i = 0; i < N; i++) { const q = p.getPointAtLength(L * i / N); pts.push([q.x, q.y]); }
  p.remove();
  // egységes körüljárási irány, hogy az átmenet ne "csavarodjon ki"
  let area = 0; pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % N]; area += x * y2 - x2 * y; });
  return area < 0 ? pts.reverse() : pts;
}
// a cél pontsort úgy forgatjuk el, hogy a pontok a legrövidebb utat tegyék meg
function align(a, b){
  let best = 0, bestD = Infinity;
  for (let k = 0; k < N; k++) {
    let s = 0; for (let i = 0; i < N; i += 3) { const p = a[i], q = b[(i + k) % N]; s += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; }
    if (s < bestD) { bestD = s; best = k; }
  }
  return b.map((_, i) => b[(i + best) % N]);
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const str = pts => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

export function startMorph(svg, poly, label, { hold = 1700, morph = 1100 } = {}){
  const shapes = SHAPES.map(([n, d]) => [n, sample(d, svg)]);
  let i = 0, cur = shapes[0][1];
  poly.setAttribute('points', str(cur)); label.textContent = shapes[0][0];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return shapes;
  const next = () => {
    const j = (i + 1) % shapes.length, from = cur, to = align(from, shapes[j][1]), t0 = performance.now();
    label.classList.add('out');
    const step = now => {
      const t = Math.min(1, (now - t0) / morph), e = ease(t);
      poly.setAttribute('points', str(from.map((p, k) => [p[0] + (to[k][0] - p[0]) * e, p[1] + (to[k][1] - p[1]) * e])));
      if (t > .5 && label.textContent !== shapes[j][0]) { label.textContent = shapes[j][0]; label.classList.remove('out'); }
      if (t < 1) requestAnimationFrame(step); else { cur = to; i = j; setTimeout(next, hold); }
    };
    requestAnimationFrame(step);
  };
  setTimeout(next, hold);
  return shapes;
}
