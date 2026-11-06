const sizes = { desktop: [1440, 1000], tablet: [834, 1112], phone: [390, 844] };
let size = 'desktop';
const frame = document.querySelector('iframe');
function fit() {
  const [width, height] = sizes[size];
  const scale = Math.min(1, document.querySelector('#stage').clientWidth / width);
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.transform = `scale(${scale})`;
  Object.assign(document.querySelector('#device').style, { width: `${width * scale}px`, height: `${height * scale}px` });
  document.querySelector('#dimensions').textContent = `${width} × ${height} · ${Math.round(scale * 100)}% 미리보기`;
}
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
  size = button.dataset.size;
  document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  fit();
}));
document.querySelectorAll('[data-design]').forEach(button => button.addEventListener('click', () => {
  const path = button.dataset.design === 'studio' ? '/studio.html' : '/original.html';
  // Keep the current screen when comparing the two designs.
  let hash = '#/';
  try { hash = frame.contentWindow.location.hash || hash; } catch { /* same origin after load */ }
  frame.src = path + hash;
  document.querySelector('#open').href = path + hash;
  document.querySelectorAll('[data-design]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
}));
frame.addEventListener('load', () => {
  const sync = () => { document.querySelector('#open').href = frame.contentWindow.location.pathname + frame.contentWindow.location.hash; };
  frame.contentWindow.addEventListener('hashchange', sync);
  sync();
});
new ResizeObserver(fit).observe(document.querySelector('#stage'));
fit();
