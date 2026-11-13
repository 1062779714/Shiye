(() => {
  if (window !== top) return;
  // Replacing the old host reconnects its listeners after an extension reload.
  document.getElementById('webfigma-helper')?.remove();
  const host = document.createElement('div');
  host.id = 'webfigma-helper';
  host.setAttribute('data-h2d-ignore', 'true');
  host.style.cssText = 'width:48px;height:48px;position:fixed;right:24px;bottom:32px;z-index:2147483647';

  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
<style>
  button {
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border: 1px solid #ffffff70;
    border-radius: 15px;
    width: 48px;
    height: 48px;
    background: #202224;
    color: white;
    box-shadow: 0 4px 14px #36307830, inset 0 1px 0 #ffffff38;
    cursor: pointer;
    transition: transform .18s ease, box-shadow .18s ease;
    padding: 0;
    overflow: hidden;
    position: relative;
  }
  button svg { width: 100%; height: 100%; display: block; }
  button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px #36307840, inset 0 1px 0 #ffffff38; }
  button:active { transform: scale(.95); }
  button:focus-visible { outline: 3px solid #b8b1ff; outline-offset: 3px; }
  button:disabled { opacity: .65; cursor: wait; }

  /* 定格计数小角标 */
  .badge-pin {
    position: absolute;
    top: 3px;
    right: 3px;
    background: #2563eb;
    color: #fff;
    font: 700 10px/1 system-ui;
    padding: 2px 5px;
    border-radius: 8px;
    display: none;
    box-shadow: 0 2px 5px rgba(0,0,0,0.4);
    z-index: 10;
  }
  .badge-pin.active { display: block; }

  p {
    position: absolute;
    right: 0;
    bottom: 54px;
    background: #25283a;
    color: #fff;
    border: 1px solid #ffffff18;
    border-radius: 9px;
    padding: 9px 12px;
    max-width: 320px;
    width: max-content;
    white-space: normal;
    box-shadow: 0 4px 16px #0002;
    font: 12px/1.5 system-ui;
    pointer-events: none;
  }
  p:empty { display: none; }
  @media(prefers-reduced-motion:reduce){ button { transition: none; } }
</style>
<p role="status" aria-live="polite"></p>
<button title="点击捕获整页 | Alt+F 原位定格模块 | Alt+C 捕获当前状态" aria-label="拾页 · 捕获网页并导入 Figma">
  <span id="pinBadge" class="badge-pin">0</span>
  <!-- 官方正版 Plan A 矢量图标：包含左上、右上、左下 3 个清晰白色取景角与右下角蓝色圆角点 -->
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
    <defs>
      <linearGradient id="base" x1="35" y1="20" x2="480" y2="512" gradientUnits="userSpaceOnUse">
        <stop stop-color="#292B2D"/>
        <stop offset="1" stop-color="#191B1C"/>
      </linearGradient>
      <linearGradient id="accent" x1="335" y1="335" x2="404" y2="404" gradientUnits="userSpaceOnUse">
        <stop stop-color="#347BFF"/>
        <stop offset="1" stop-color="#2460EB"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="108" fill="url(#base)"/>
    <g stroke="#FFFFFF" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
      <path d="M128 211V169C128 146 146 128 169 128H211"/>
      <path d="M301 128H343C366 128 384 146 384 169V211"/>
      <path d="M128 301V343C128 366 146 384 169 384H211"/>
    </g>
    <rect x="335" y="335" width="64" height="64" rx="12" fill="url(#accent)"/>
  </svg>
</button>
`;

  document.documentElement.append(host);
  const button = root.querySelector('button');
  const label = root.querySelector('p');
  const pinBadge = root.querySelector('#pinBadge');

  let visibilityTimer;
  const show = () => { clearTimeout(visibilityTimer); host.style.visibility = 'visible'; };

  function updateBadge() {
    const count = window.__pagepickHoverEngine ? window.__pagepickHoverEngine.count() : 0;
    if (count > 0) {
      pinBadge.textContent = String(count);
      pinBadge.classList.add('active');
    } else {
      pinBadge.classList.remove('active');
    }
  }

  chrome.runtime.onMessage.addListener(m => {
    if (m.type === 'STATUS') label.textContent = m.text;
    if (m.type === 'CAPTURE_UI') {
      if (m.hidden) {
        host.style.visibility = 'hidden';
        clearTimeout(visibilityTimer);
        visibilityTimer = setTimeout(show, 95000);
      } else show();
    }
    if (m.type === 'TASK_FINISHED') {
      show();
      button.disabled = false;
      if (window.__pagepickHoverEngine) {
        window.__pagepickHoverEngine.unlockAll();
        updateBadge();
      }
    }
  });

  // ── 鼠标轨迹记录 ──────────────────────────────────────────────────
  let mouseX = 0, mouseY = 0;
  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { passive: true });

  // ── 原位定格触发 (In-Place Pin) ──────────────────────────────────
  function pinHoverModuleInPlace() {
    if (!window.__pagepickHoverEngine) return;

    const el = document.elementFromPoint(mouseX, mouseY);
    if (!el || el === document.body || el === document.documentElement || el.closest('#webfigma-helper')) {
      label.textContent = '请将鼠标悬停在需要定格的模块卡片或按钮上';
      return;
    }

    let target = el;
    while (target && target !== document.body) {
      const rect = target.getBoundingClientRect();
      const style = window.getComputedStyle(target);
      if (rect.width >= 30 && rect.height >= 20) {
        if (target.getAttribute('role') || target.tagName === 'LI' || target.tagName === 'BUTTON' || target.tagName === 'A' ||
            ['relative', 'absolute', 'fixed'].includes(style.position) ||
            style.boxShadow !== 'none' || (style.borderWidth && style.borderWidth !== '0px')) {
          break;
        }
      }
      if (target.parentElement === document.body) break;
      target = target.parentElement;
    }

    if (!target) target = el;

    window.__pagepickHoverEngine.lockElement(target);
    updateBadge();

    const count = window.__pagepickHoverEngine.count();
    const name = (target.textContent || '模块').trim().replace(/\s+/g, ' ').slice(0, 10);
    label.textContent = `📌 原位定格 [${name}] (已锁定${count}个)！移开鼠标依然保持，正常随页面滚动；点大图标即可整页导出`;
  }

  // ── 常规整页捕获 ──────────────────────────────────────────────────
  button.onclick = async () => {
    button.disabled = true;
    const count = window.__pagepickHoverEngine ? window.__pagepickHoverEngine.count() : 0;
    label.textContent = count > 0 
      ? `正在捕获包含 ${count} 个锁定 hover 态的整页…` 
      : '准备捕获…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'RUN_CAPTURE' });
      if (!result?.ok) label.textContent = result?.error || '操作失败';
    } catch (e) {
      label.textContent = e.message;
    } finally {
      host.style.visibility = 'visible';
      button.disabled = false;
    }
  };

  // ── 快捷键监听 ────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      e.stopPropagation();
      pinHoverModuleInPlace();
      return;
    }

    if (e.altKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      e.stopPropagation();
      label.textContent = '定格当前状态并导入 Figma…';
      chrome.runtime.sendMessage({ type: 'RUN_STATE_CAPTURE' }).then(result => {
        if (!result?.ok) label.textContent = result?.error || '操作失败';
      }).catch(err => {
        label.textContent = err.message;
      });
      return;
    }

    if (e.key === 'Escape') {
      if (window.__pagepickHoverEngine && window.__pagepickHoverEngine.count() > 0) {
        window.__pagepickHoverEngine.unlockAll();
        updateBadge();
        label.textContent = '已清除所有定格状态';
      }
    }
  }, true);
})();
