(async function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const input = document.getElementById('poster-url');
  const box = document.getElementById('poster-qr');
  const address = document.getElementById('poster-address');

  // Draws the QR code as one SVG path, so it prints sharp at any size.
  function draw() {
    const base = input.value.trim().replace(/\/+$/, '');
    const url = `${base}/submit`;
    address.textContent = url.replace(/^https?:\/\//, '');
    try {
      const qr = qrcode(0, 'M'); // size chosen automatically, medium error correction
      qr.addData(url);
      qr.make();
      const count = qr.getModuleCount();
      const margin = 4; // the quiet zone scanners need around the code
      let path = '';
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
        }
      }
      const size = count + margin * 2;
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
      svg.setAttribute('shape-rendering', 'crispEdges');
      const background = document.createElementNS(SVG, 'rect');
      background.setAttribute('width', size);
      background.setAttribute('height', size);
      background.setAttribute('fill', '#fff');
      const modules = document.createElementNS(SVG, 'path');
      modules.setAttribute('d', path);
      modules.setAttribute('fill', '#000');
      svg.append(background, modules);
      box.replaceChildren(svg);
    } catch {
      box.replaceChildren(); // an address too long for a QR code: show nothing rather than a wrong code
    }
  }

  let base = location.origin;
  try {
    const meta = await SB.meta();
    if (meta.publicUrl) base = meta.publicUrl;
  } catch { /* fall back to the address in the browser */ }
  input.value = base.replace(/\/+$/, '');

  input.addEventListener('input', SB.debounce(draw, 200));
  document.getElementById('poster-form').addEventListener('submit', (event) => event.preventDefault());
  document.getElementById('poster-print').addEventListener('click', () => window.print());
  draw();
})();
