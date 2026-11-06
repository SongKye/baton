// Default on wide screens; studio.html keeps the all-size design preview.
const responsive = document.documentElement.dataset.studio === 'responsive';
const wide = matchMedia('(min-width: 760px)');
const enabled = () => !responsive || wide.matches;
const originalChildren = new WeakMap();
const ko = window.LANG === 'ko';
const copy = (a, b) => ko ? a : b;
const nav = document.querySelector('#tabbar');
const brand = document.createElement('div');
brand.className = 'studio-brand';
brand.innerHTML = '<span class="baton-mark studio-mark" aria-hidden="true"></span><strong>baton<span>WORKSPACE / STUDIO</span></strong>';
const foot = document.createElement('div');
foot.className = 'studio-foot';
foot.innerHTML = `<span>MAKE SOMETHING GOOD.</span><a href="/preview.html">${copy('화면 비교', 'Compare layouts')} ↗</a><a href="/original.html">${copy('기존 화면으로', 'Original layout')} ↗</a>`;

function decorate() {
  if (!enabled()) return;
  const view = document.querySelector('main.view');
  if (!view?.querySelector(':scope > .stats') || view.querySelector('.studio-intro')) return;
  originalChildren.set(view, [...view.children]);
  view.classList.add('studio-home');
  const intro = document.createElement('section');
  intro.className = 'studio-intro';
  const date = new Intl.DateTimeFormat(ko ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  intro.innerHTML = `<div class="studio-eyebrow">YOUR PERSONAL AI WORKSPACE <span>${date}</span></div>
    <div class="studio-heading"><div><h2>${copy('좋은 흐름을,', 'Keep your ideas.')}<br><em>${copy('계속 이어가요.', 'Keep your flow.')}</em></h2><p>${copy('흩어진 AI 작업을 한곳에. 여기서 다음을 시작하세요.', 'All your AI work, together. Pick up where inspiration left off.')}</p></div>
    <a href="#/new" class="studio-start"><span aria-hidden="true">↗</span>${copy('새로운 작업 시작', 'Start something new')}</a></div>`;
  view.prepend(intro);
  const sections = [...view.querySelectorAll(':scope > .section:not(#home-usage)')];
  const primary = document.createElement('div');
  primary.className = 'studio-primary';
  const secondary = document.createElement('aside');
  secondary.className = 'studio-secondary';
  secondary.setAttribute('aria-label', copy('프로젝트와 사용량', 'Projects and usage'));
  for (const section of sections) {
    // The "new version" banner spans the full width above the intro instead of sinking into the side column.
    if (section.querySelector('.update-banner')) { section.classList.add('studio-update'); view.prepend(section); continue; }
    (section.querySelector('.srow') || section.querySelector('a[href="#/sessions"]') ? primary : secondary).append(section);
  }
  const usage = view.querySelector('#home-usage');
  if (usage) secondary.prepend(usage);
  view.append(primary, secondary);
}
new MutationObserver(decorate).observe(document.querySelector('#app'), { childList: true, subtree: true });
function syncLayout() {
  if (enabled()) {
    nav.prepend(brand);
    nav.append(foot);
    decorate();
  } else {
    brand.remove();
    foot.remove();
    const view = document.querySelector('main.view.studio-home');
    if (!view) return;
    // Move the same nodes back, preserving listeners and async usage updates.
    for (const child of originalChildren.get(view) || []) {
      if (view.contains(child)) view.append(child);
    }
    view.querySelectorAll(':scope > .studio-intro, :scope > .studio-primary, :scope > .studio-secondary').forEach(el => el.remove());
    view.querySelector(':scope > .studio-update')?.classList.remove('studio-update');
    view.classList.remove('studio-home');
    originalChildren.delete(view);
  }
}
if (responsive) wide.addEventListener('change', syncLayout);
syncLayout();
