(() => {
  if (window !== top) return;
  // Replacing the old host reconnects its listeners after an extension reload.
  document.getElementById('webfigma-helper')?.remove();
  const host = document.createElement('div');
  host.id = 'webfigma-helper';
  host.setAttribute('data-h2d-ignore', 'true');
  host.style.cssText = 'position:fixed;right:24px;bottom:32px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;';

  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
<style>
  * { box-sizing: border-box; pointer-events: auto; }
  .wrapper { display: flex; flex-direction: column; align-items: flex-end; position: relative; }
  .btn-main {
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
  }
  .btn-main svg { width: 100%; height: 100%; display: block; }
  .btn-main:hover { transform: translateY(-2px); box-shadow: 0 6px 20px #36307840, inset 0 1px 0 #ffffff38; }
  .btn-main:active { transform: scale(.95); }
  .btn-main:disabled, .btn-action:disabled { opacity: .65; cursor: wait; }

  /* 悬停展开的操作条 */
  .sub-menu {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
    transition: opacity .2s ease, transform .2s ease;
  }
  .wrapper:hover .sub-menu, .wrapper:focus-within .sub-menu {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .btn-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 15px;
    background: #1e2024ee;
    backdrop-filter: blur(8px);
    border: 1px solid #ffffff25;
    color: #e2e8f0;
    font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    transition: background .15s ease, color .15s ease, transform .15s ease;
    white-space: nowrap;
  }
  .btn-action kbd {
    background: #ffffff20;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 10px;
    color: #cbd5e1;
  }
  .btn-action:hover {
    background: #2563eb;
    color: #fff;
    border-color: #3b82f6;
    transform: translateY(-1px);
  }

  p {
    position: absolute;
    right: 0;
    bottom: 56px;
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

  /* 状态定格闪烁动画 */
  .flash-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: white;
    opacity: 0;
    pointer-events: none;
    z-index: 2147483646;
    transition: opacity 0.15s ease-out;
  }
  .flash-active {
    opacity: 0.35;
  }
  @media(prefers-reduced-motion:reduce){ button, .sub-menu { transition: none; } }
</style>
<div class="flash-overlay" id="flash"></div>
<div class="wrapper">
  <div class="sub-menu">
    <button id="btnStateCapture" class="btn-action" title="零失焦、零滚动捕获当前展开的菜单或弹窗">
      <span>✨ 捕获当前状态</span>
      <kbd>Alt + C</kbd>
    </button>
  </div>
  <p role="status" aria-live="polite"></p>
  <button id="btnCapture" class="btn-main" title="点击整页捕获 | 快捷键 Alt+C 捕获当前状态" aria-label="拾页 · 捕获网页并导入 Figma">
    <svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clip-path="url(#clip0_22_5262)">
        <path d="M404 0H108C48.3532 0 0 48.3532 0 108V404C0 463.647 48.3532 512 108 512H404C463.647 512 512 463.647 512 404V108C512 48.3532 463.647 0 404 0Z" fill="url(#paint0_linear_22_5262)"/>
        <path d="M102 202V151.398C102 123.687 123.687 102 151.398 102H202" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" stroke-white"/>
        <path d="M310 102H360.602C388.313 102 410 123.687 410 151.398V202" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" stroke-white"/>
        <path d="M102 310V360.602C102 388.313 123.687 410 151.398 410H202" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" stroke-white"/>
        <path d="M396.812 310H326.188C314.486 310 305 319.486 305 331.188V401.812C305 413.514 314.486 423 326.188 423H396.812C408.514 423 418 413.514 418 401.812V331.188C418 319.486 408.514 310 396.812 310Z" fill="url(#paint1_linear_22_5262)"/>
      </g>
      <defs>
        <linearGradient id="paint0_linear_22_5262" x1="35" y1="20" x2="480" y2="512" gradientUnits="userSpaceOnUse">
          <stop stop-color="#292B2D"/>
          <stop offset="1" stop-color="#191B1C"/>
        </linearGradient>
        <linearGradient id="paint1_linear_22_5262" x1="305" y1="310" x2="426.828" y2="431.828" gradientUnits="userSpaceOnUse">
          <stop stop-color="#347BFF"/>
          <stop offset="1" stop-color="#2460EB"/>
        </linearGradient>
        <clipPath id="clip0_22_5262"><rect width="512" height="512" fill="white"/></clipPath>
      </defs>
    </svg>
  </button>
</div>
`;

  document.documentElement.append(host);
  const btnCapture = root.querySelector('#btnCapture');
  const btnStateCapture = root.querySelector('#btnStateCapture');
  const label = root.querySelector('p');
  const flash = root.querySelector('#flash');

  let visibilityTimer;
  const show = () => { clearTimeout(visibilityTimer); host.style.visibility = 'visible'; };

  function triggerFlash() {
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 150);
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
      btnCapture.disabled = false;
      btnStateCapture.disabled = false;
    }
  });

  // 常规整页捕获（目标①）
  async function triggerCapture() {
    btnCapture.disabled = true;
    btnStateCapture.disabled = true;
    label.textContent = '准备捕获…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'RUN_CAPTURE' });
      if (!result?.ok) label.textContent = result?.error || '操作失败';
    } catch (e) {
      label.textContent = e.message;
    } finally {
      host.style.visibility = 'visible';
      btnCapture.disabled = false;
      btnStateCapture.disabled = false;
    }
  }

  // 状态定格捕获（目标②：零滚动、零失焦，原位截取）
  async function triggerStateCapture() {
    triggerFlash();
    label.textContent = '定格当前状态并导入 Figma…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'RUN_STATE_CAPTURE' });
      if (!result?.ok) label.textContent = result?.error || '操作失败';
    } catch (e) {
      label.textContent = e.message;
    }
  }

  btnCapture.onclick = () => triggerCapture();
  btnStateCapture.onclick = () => triggerStateCapture();

  // 监听键盘 Alt+C（Mac 为 Option+C）无干扰瞬间触发
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      e.stopPropagation();
      triggerStateCapture();
    }
  }, true);
})();
