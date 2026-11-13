(() => {
  if (window !== top) return;
  const isExtensionAlive = () => {
    try {
      return typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  };
  if (!isExtensionAlive()) return;
  if (window.location.pathname.includes('/login')) return;

  const safeSendMessage = (msg) => {
    if (!isExtensionAlive() || !chrome?.runtime?.sendMessage) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  const safeStorageGet = (keys) => {
    if (!isExtensionAlive() || !chrome?.storage?.local) return Promise.resolve({});
    try {
      return chrome.storage.local.get(keys).catch(() => ({}));
    } catch {
      return Promise.resolve({});
    }
  };

  const safeStorageSet = (data) => {
    if (!isExtensionAlive() || !chrome?.storage?.local) return Promise.resolve();
    try {
      return chrome.storage.local.set(data).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };

  // Replacing the old host reconnects its listeners after an extension reload.
  document.getElementById('webfigma-helper')?.remove();
  const host = document.createElement('div');
  host.id = 'webfigma-helper';
  host.setAttribute('data-h2d-ignore', 'true');
  host.style.cssText = 'position:fixed;right:24px;bottom:32px;width:48px;height:48px;z-index:2147483647;pointer-events:none;';

  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
<style>
  * { box-sizing: border-box; }
  
  /* 主捕获按钮 48x48，支持全屏自由拖拽 */
  #captureBtn {
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
    transition: box-shadow .18s ease;
    padding: 0;
    overflow: hidden;
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  #captureBtn.dragging { cursor: grabbing !important; }
  #captureBtn svg { width: 100%; height: 100%; display: block; pointer-events: none; }
  #captureBtn:hover { box-shadow: 0 6px 20px #36307840, inset 0 1px 0 #ffffff38; }
  #captureBtn:focus-visible { outline: 3px solid #b8b1ff; outline-offset: 3px; }
  #captureBtn:disabled { opacity: .65; cursor: wait; }

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

  /* 顶部全局提示条 (居中悬浮，绝不与任何右下角按钮重叠) */
  #statusToast {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(26, 28, 32, 0.96);
    backdrop-filter: blur(12px);
    color: #fff;
    border: 1px solid rgba(52, 123, 255, 0.45);
    border-radius: 20px;
    padding: 8px 22px;
    max-width: 520px;
    width: max-content;
    white-space: normal;
    text-align: center;
    box-shadow: 0 8px 28px rgba(0,0,0,0.45), 0 0 16px rgba(52, 123, 255, 0.25);
    font: 600 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    pointer-events: none;
    z-index: 2147483647;
    display: none;
    animation: toastIn .18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translate(-50%, -10px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }

  /* 批量清单折叠药丸胶囊 (严格 48px 宽，与下方图标等宽同轴) */
  #batchPill {
    position: absolute;
    left: 0;
    bottom: 54px;
    width: 48px;
    height: 22px;
    border-radius: 11px;
    background: #202224;
    color: #e5e7eb;
    border: 1px solid #ffffff30;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 7.5px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0.9px;
    text-indent: 0.9px;
    text-align: center;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    pointer-events: auto;
    transition: all .18s ease;
    user-select: none;
    white-space: nowrap;
    padding: 0 1px;
    box-sizing: border-box;
  }
  #batchPill:hover {
    background: #2c2f33;
    border-color: #347BFF;
    color: #fff;
  }
  #batchPill.active {
    background: #182438;
    border-color: #347BFF;
    color: #60a5fa;
    box-shadow: 0 4px 14px rgba(52, 123, 255, 0.25);
  }

  /* 批量采集清单卡片 (抽屉面板) */
  #batchDrawer {
    position: absolute;
    right: 0;
    bottom: 92px;
    width: 340px;
    background: rgba(26, 28, 30, 0.96);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
    color: #e5e7eb;
    font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: drawerIn .18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  #batchDrawer.hidden { display: none; }
  @keyframes drawerIn {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* 卡片头部 */
  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 13px;
    color: #f3f4f6;
  }
  .header-count {
    font-size: 11px;
    color: #9ca3af;
    font-weight: normal;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn-text {
    background: none;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    transition: color .15s;
  }
  .btn-text:hover { color: #f3f4f6; }
  .btn-close {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .btn-close:hover { color: #f87171; }

  /* 提示与操作栏 */
  .drawer-hint {
    background: rgba(52, 123, 255, 0.08);
    border-bottom: 1px solid rgba(52, 123, 255, 0.15);
    padding: 7px 12px;
    font-size: 11px;
    color: #93c5fd;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .hint-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-record-view {
    background: rgba(52, 123, 255, 0.18);
    border: 1px solid rgba(52, 123, 255, 0.35);
    color: #60a5fa;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all .15s;
  }
  .btn-record-view:hover {
    background: rgba(52, 123, 255, 0.3);
    color: #fff;
  }

  /* 清单列表区域 */
  .drawer-list {
    max-height: 230px;
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .drawer-list::-webkit-scrollbar { width: 4px; }
  .drawer-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }

  /* 清单单项 */
  .list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    transition: background .15s;
  }
  .list-item:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .list-item input[type="checkbox"] {
    cursor: pointer;
    accent-color: #347BFF;
    width: 15px;
    height: 15px;
    margin: 0;
    flex-shrink: 0;
  }
  .item-title {
    flex: 1;
    font-size: 12px;
    color: #e5e7eb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .item-title:hover {
    color: #60a5fa;
    text-decoration: underline;
  }
  .item-badge {
    font-size: 11px;
    padding: 0 6px;
    height: 20px;
    line-height: 1;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    white-space: nowrap;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .badge-pending { background: rgba(255, 255, 255, 0.08); color: #9ca3af; }
  .badge-running { background: rgba(52, 123, 255, 0.2); color: #60a5fa; }
  .badge-success { background: rgba(16, 185, 129, 0.2); color: #34d399; }
  .badge-failed { background: rgba(239, 68, 68, 0.2); color: #f87171; }
  
  .btn-retry {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e5e7eb;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 0 6px;
    height: 20px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    text-decoration: none;
    transition: all .15s ease;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .btn-retry:hover {
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.25);
  }
  .btn-del {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
    transition: opacity .15s, color .15s;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .list-item:hover .btn-del { opacity: 1; }
  .btn-del:hover { color: #f87171; }

  .empty-hint {
    padding: 24px 12px;
    text-align: center;
    font-size: 12px;
    color: #6b7280;
  }

  /* 底部操作区 */
  .drawer-footer {
    padding: 10px 14px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .btn-batch-run {
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, #347BFF 0%, #2460EB 100%);
    color: #fff;
    font: 600 12px system-ui, sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(36, 96, 235, 0.35);
    transition: all .18s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .btn-batch-run:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(36, 96, 235, 0.45);
  }
  .btn-batch-run:active { transform: scale(0.98); }
  .btn-batch-run:disabled {
    background: #374151;
    color: #9ca3af;
    cursor: not-allowed;
    box-shadow: none;
  }

  .btn-batch-stop {
    background: #ef4444 !important;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35) !important;
  }

  @media(prefers-reduced-motion:reduce){ #captureBtn, #batchDrawer { transition: none; animation: none; } }
</style>

<!-- 顶部全局提示框 (居中悬浮) -->
<div id="statusToast"></div>

<!-- 批量采集抽屉卡片 -->
<div id="batchDrawer" class="hidden">
  <div class="drawer-header">
    <div class="header-left">
      <span>📋 批量采集清单</span>
      <span id="batchCount" class="header-count">(0)</span>
    </div>
    <div class="header-actions">
      <button id="btnClear" class="btn-text" title="清空清单">清空</button>
      <button id="btnCloseDrawer" class="btn-close" title="收起面板">✕</button>
    </div>
  </div>
  <div class="drawer-hint">
    <span>💡 切换菜单或点击网页自动记录</span>
    <div class="hint-actions">
      <button id="btnRecordView" class="btn-record-view" title="手动将当前页面的激活视图/选项卡加到清单">＋ 记录当前画面</button>
      <button id="btnToggleMode" class="btn-text" style="color:#9ca3af;">退出</button>
    </div>
  </div>
  <div id="batchListContainer" class="drawer-list">
    <div class="empty-hint">暂无页面，点击各网页或菜单将自动记录</div>
  </div>
  <div class="drawer-footer">
    <button id="btnRunBatch" class="btn-batch-run">
      🚀 开始自动采集 (已选 0 项)
    </button>
  </div>
</div>

<!-- 批量模式胶囊折叠药丸 (48px 宽，仅保留 4 个字“自动采集”) -->
<div id="batchPill" title="点击开启自动采集">
  <span id="pillLabel">自动采集</span>
</div>

<!-- 主捕获按钮 (48x48，支持全屏自由拖拽) -->
<button id="captureBtn" title="按住可拖动位置 | 点击捕获整页 | Alt+F 原位定格模块 | Alt+C 捕获当前状态" aria-label="拾页 · 捕获网页并导入 Figma">
  <span id="pinBadge" class="badge-pin">0</span>
  <!-- 官方正版 Plan A 矢量图标 -->
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
  const captureBtn = root.querySelector('#captureBtn');
  const statusToast = root.querySelector('#statusToast');
  const pinBadge = root.querySelector('#pinBadge');
  const batchPill = root.querySelector('#batchPill');
  const pillLabel = root.querySelector('#pillLabel');
  const batchDrawer = root.querySelector('#batchDrawer');
  const batchListContainer = root.querySelector('#batchListContainer');
  const batchCount = root.querySelector('#batchCount');
  const btnClear = root.querySelector('#btnClear');
  const btnCloseDrawer = root.querySelector('#btnCloseDrawer');
  const btnToggleMode = root.querySelector('#btnToggleMode');
  const btnRecordView = root.querySelector('#btnRecordView');
  const btnRunBatch = root.querySelector('#btnRunBatch');

  let currentBatchData = { active: false, list: [], isExecuting: false };
  let drawerExplicitlyClosed = false;

  // ── 自由拖动与智能吸附视口守护 ───────────────────────────────────
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let initialHostLeft = 0, initialHostTop = 0;
  let hasMoved = false;
  let suppressClick = false;

  function updateLayoutOrientation(x, y) {
    // 左右半区自适应：
    // 当在屏幕左半区时，抽屉和药丸与主图标左边缘严格对齐 (left: 0, right: auto)
    // 当在屏幕右半区时，抽屉和药丸与主图标右边缘严格对齐 (right: 0, left: auto)
    if (x < window.innerWidth / 2) {
      batchPill.style.right = 'auto';
      batchPill.style.left = '0';
      batchDrawer.style.right = 'auto';
      batchDrawer.style.left = '0';
    } else {
      batchPill.style.left = 'auto';
      batchPill.style.right = '0';
      batchDrawer.style.left = 'auto';
      batchDrawer.style.right = '0';
    }

    // 上下半区自适应：
    if (y < 420) {
      // 上半区：胶囊和抽屉向下方展开
      batchPill.style.bottom = 'auto';
      batchPill.style.top = '54px';
      batchDrawer.style.bottom = 'auto';
      batchDrawer.style.top = '54px';
    } else {
      // 下半区：胶囊和抽屉向上方展开
      batchPill.style.top = 'auto';
      batchPill.style.bottom = '54px';
      batchDrawer.style.top = 'auto';
      batchDrawer.style.bottom = '54px';
    }
  }

  function applyHostPosition(pos) {
    if (!pos) return;
    const isBottom = pos.anchorY === 'bottom';
    const isRight = pos.anchorX === 'right';

    if (isBottom) {
      const b = Math.max(10, Math.min(window.innerHeight - 58, pos.offsetBottom ?? 32));
      host.style.top = 'auto';
      host.style.bottom = b + 'px';
    } else {
      const t = Math.max(10, Math.min(window.innerHeight - 58, pos.offsetTop ?? 10));
      host.style.bottom = 'auto';
      host.style.top = t + 'px';
    }

    if (isRight) {
      const r = Math.max(10, Math.min(window.innerWidth - 58, pos.offsetRight ?? 24));
      host.style.left = 'auto';
      host.style.right = r + 'px';
    } else {
      const l = Math.max(10, Math.min(window.innerWidth - 58, pos.offsetLeft ?? 10));
      host.style.right = 'auto';
      host.style.left = l + 'px';
    }

    const rect = host.getBoundingClientRect();
    updateLayoutOrientation(rect.left, rect.top);
  }

  captureBtn.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = host.getBoundingClientRect();
    initialHostLeft = rect.left;
    initialHostTop = rect.top;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.hypot(dx, dy) > 5) {
      hasMoved = true;
      captureBtn.classList.add('dragging');
    }
    if (hasMoved) {
      let newLeft = initialHostLeft + dx;
      let newTop = initialHostTop + dy;
      newLeft = Math.max(10, Math.min(window.innerWidth - 58, newLeft));
      newTop = Math.max(10, Math.min(window.innerHeight - 58, newTop));
      host.style.left = newLeft + 'px';
      host.style.top = newTop + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      updateLayoutOrientation(newLeft, newTop);
    }
  });

  window.addEventListener('mouseup', async () => {
    if (!isDragging) return;
    isDragging = false;
    captureBtn.classList.remove('dragging');
    if (hasMoved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 250);
      const rect = host.getBoundingClientRect();
      const isRight = (rect.left + 24) > (window.innerWidth / 2);
      const isBottom = (rect.top + 24) > (window.innerHeight / 2);

      const posData = {
        anchorX: isRight ? 'right' : 'left',
        anchorY: isBottom ? 'bottom' : 'top',
        offsetRight: Math.max(10, window.innerWidth - rect.right),
        offsetLeft: Math.max(10, rect.left),
        offsetBottom: Math.max(10, window.innerHeight - rect.bottom),
        offsetTop: Math.max(10, rect.top)
      };

      // 立即使用相对锚点吸附，确保后续调整窗口大小时始终紧跟边缘
      applyHostPosition(posData);
      await safeStorageSet({ savedIconAnchor: posData }).catch(() => {});
    }
  });

  // 窗口大小变动时，实时防止图标被截断
  window.addEventListener('resize', () => {
    const rect = host.getBoundingClientRect();
    // 边界钳制，确保图标始终在视口内部完整展现
    if (rect.bottom > window.innerHeight - 10) {
      host.style.top = 'auto';
      host.style.bottom = '10px';
    }
    if (rect.right > window.innerWidth - 10) {
      host.style.left = 'auto';
      host.style.right = '10px';
    }
    if (rect.top < 10) {
      host.style.bottom = 'auto';
      host.style.top = '10px';
    }
    if (rect.left < 10) {
      host.style.right = 'auto';
      host.style.left = '10px';
    }
    const current = host.getBoundingClientRect();
    updateLayoutOrientation(current.left, current.top);
  });

  // 读取已保存的拖动位置与显示开关
  (async () => {
    const { savedIconAnchor, savedIconPosition, showFloatingIcon } = await safeStorageGet(['savedIconAnchor', 'savedIconPosition', 'showFloatingIcon']);
    if (showFloatingIcon === false) {
      host.style.display = 'none';
    }
    if (savedIconAnchor && savedIconAnchor.anchorX) {
      applyHostPosition(savedIconAnchor);
    } else if (savedIconPosition && typeof savedIconPosition.xRatio === 'number') {
      const isRight = savedIconPosition.xRatio > 0.5;
      const isBottom = savedIconPosition.yRatio > 0.5;
      applyHostPosition({
        anchorX: isRight ? 'right' : 'left',
        anchorY: isBottom ? 'bottom' : 'top',
        offsetRight: 24,
        offsetBottom: 32,
        offsetLeft: Math.max(10, savedIconPosition.xRatio * window.innerWidth),
        offsetTop: Math.max(10, savedIconPosition.yRatio * window.innerHeight)
      });
    } else {
      // 默认右下角安全定位
      applyHostPosition({ anchorX: 'right', anchorY: 'bottom', offsetRight: 24, offsetBottom: 32 });
    }
  })();

  function showToast(text, duration = 4000) {
    statusToast.textContent = text;
    statusToast.style.display = 'block';
    if (duration > 0) {
      setTimeout(() => {
        if (statusToast.textContent === text) statusToast.style.display = 'none';
      }, duration);
    }
  }

  function cleanPageTitle(fullTitle) {
    if (!fullTitle) return '未命名页面';
    const firstPart = fullTitle.split(/[-_|–—]/)[0].trim();
    return firstPart || fullTitle.slice(0, 20);
  }

  // ── 渲染批量清单 UI ──────────────────────────────────────────────────
  function renderBatchUI(active, list, isExecuting) {
    currentBatchData = { active, list, isExecuting };
    const selectedCount = list.filter(x => x.selected).length;

    // 胶囊文本固定为“自动采集”（48px 等宽紧凑）
    pillLabel.textContent = '自动采集';

    // 互斥显示：列表展开时隐藏胶囊，列表关闭时显示胶囊
    if (active) {
      batchPill.classList.add('active');
      batchDrawer.classList.remove('hidden');
      batchPill.style.display = 'none'; // 互斥：抽屉打开时隐藏胶囊
    } else {
      batchPill.classList.remove('active');
      batchDrawer.classList.add('hidden');
      batchPill.style.display = 'flex'; // 抽屉收起时显示胶囊
    }

    batchCount.textContent = `(已选 ${selectedCount}/${list.length})`;

    // 运行按钮状态
    if (isExecuting) {
      btnRunBatch.classList.add('btn-batch-stop');
      btnRunBatch.textContent = '⏹️ 停止批量采集';
      btnRunBatch.disabled = false;
    } else {
      btnRunBatch.classList.remove('btn-batch-stop');
      btnRunBatch.textContent = selectedCount > 0 
        ? `🚀 开始自动采集 (${selectedCount}项)`
        : '🚀 请先勾选要采集的网页';
      btnRunBatch.disabled = (selectedCount === 0);
    }

    // 渲染列表项
    if (list.length === 0) {
      batchListContainer.innerHTML = '<div class="empty-hint">暂无页面，点击各网页或菜单将自动记录</div>';
      return;
    }

    batchListContainer.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'list-item';

      // 多选框 (默认不选中，用户勾选再采)
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!item.selected;
      chk.onchange = (e) => {
        e.stopPropagation();
        safeSendMessage({ type: 'BATCH_TOGGLE_ITEM', id: item.id, selected: chk.checked });
      };
      row.appendChild(chk);

      // 网页/视图名称（点击跳转该网址或在页面内切换 Tab）
      const titleSpan = document.createElement('span');
      titleSpan.className = 'item-title';
      titleSpan.textContent = item.title || '未命名网页';
      titleSpan.title = `点击跳转: ${item.url}` + (item.tabText ? ` (子菜单: ${item.tabText})` : '');
      titleSpan.onclick = async () => {
        showToast(`正在跳转: ${item.title || item.url}…`, 2000);

        // 1. 如果具有子菜单/Tab 属性，优先在当前页面内寻找并激活对应的选项卡
        let tabSwitched = false;
        if (item.tabText) {
          const allEls = Array.from(document.querySelectorAll('[role="tab"], [class*="tab"], li, button, a, span, div'));
          // 深度优先：寻找文本严格等于 tabText 的叶子节点
          let targetEl = allEls.find(el => el.children.length === 0 && el.textContent?.trim() === item.tabText && el.offsetWidth > 0);
          if (!targetEl) {
            targetEl = allEls.find(el => el.textContent?.trim() === item.tabText && el.offsetWidth > 0);
          }
          if (!targetEl) {
            targetEl = allEls.find(el => el.textContent?.includes(item.tabText) && el.offsetWidth > 0 && el.offsetHeight > 0);
          }
          if (targetEl) {
            const clickable = targetEl.closest('button, [role="tab"], li, a') || targetEl;
            clickable.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
              clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            });
            clickable.click?.();
            tabSwitched = true;
          }
        }

        // 2. 如果网址不同，或者属于跨页项，直接执行页面导航并通知后台
        if (item.url) {
          safeSendMessage({ type: 'BATCH_NAVIGATE', url: item.url }).catch(() => {});
          if (!tabSwitched || item.url !== window.location.href) {
            window.location.href = item.url;
          }
        }
      };
      row.appendChild(titleSpan);

      // 状态标签与错误提示
      const badge = document.createElement('span');
      badge.className = `item-badge badge-${item.status || 'pending'}`;
      if (item.status === 'running') {
        badge.textContent = '⏳ 采集中...';
      } else if (item.status === 'success') {
        badge.textContent = '✅ 成功';
      } else if (item.status === 'failed') {
        const errMsg = item.error || '失败原因未知';
        badge.title = `失败原因: ${errMsg}`;
        badge.textContent = '❌ 失败';
      } else {
        badge.textContent = '等待';
      }
      row.appendChild(badge);

      // 失败单项独立重试胶囊按钮（严格水平居中对齐）
      if (item.status === 'failed') {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn-retry';
        retryBtn.textContent = '↻ 重试';
        retryBtn.title = `重新采集当前项 (原因: ${item.error || '未知'})`;
        retryBtn.onclick = (e) => {
          e.stopPropagation();
          safeSendMessage({ type: 'BATCH_RETRY_ITEM', id: item.id });
        };
        row.appendChild(retryBtn);
      }

      // 删除单项按钮
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-del';
      delBtn.textContent = '✕';
      delBtn.title = '从清单移除';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        safeSendMessage({ type: 'BATCH_REMOVE_ITEM', id: item.id });
      };
      row.appendChild(delBtn);

      batchListContainer.appendChild(row);
    });
  }

  // 药丸点击：开启并展开自动采集
  batchPill.onclick = async (e) => {
    e.stopPropagation();
    batchPill.style.display = 'none';
    batchDrawer.classList.remove('hidden');
    batchPill.classList.add('active');
    await safeSendMessage({ type: 'BATCH_TOGGLE_MODE', forceActive: true });
  };

  // 面板关闭按钮 (✕)
  btnCloseDrawer.onclick = async () => {
    batchDrawer.classList.add('hidden');
    batchPill.style.display = 'flex';
    batchPill.classList.remove('active');
    await safeSendMessage({ type: 'BATCH_TOGGLE_MODE', forceActive: false });
  };

  // 退出批量模式
  btnToggleMode.onclick = async () => {
    batchDrawer.classList.add('hidden');
    batchPill.style.display = 'flex';
    batchPill.classList.remove('active');
    await safeSendMessage({ type: 'BATCH_TOGGLE_MODE', forceActive: false });
  };

  // 清空清单
  btnClear.onclick = () => {
    safeSendMessage({ type: 'BATCH_CLEAR_ALL' });
  };

  let lastDetectedTab = '';

  // 通用 Tab 识别算法：无需硬编码 CSS 类名，根据兄弟结构与短文本特征智能识别
  function findTabFromElement(target) {
    let el = target;
    for (let i = 0; i < 4 && el && el !== document.body; i++) {
      const text = el.textContent?.trim();
      if (text && text.length >= 2 && text.length <= 16 && !text.includes('\n')) {
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.offsetWidth > 0);
          if (siblings.length >= 2 && siblings.length <= 20) {
            const shortTexts = siblings
              .map(c => c.textContent?.trim())
              .filter(t => t && t.length >= 2 && t.length <= 16 && !t.includes('\n'));
            if (shortTexts.length >= 2) {
              return { el, text, siblings };
            }
          }
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  // 寻找当前页面中处于激活高亮状态的 Tab 名称
  function getActiveTabText() {
    if (lastDetectedTab) return lastDetectedTab;
    const attrActive = document.querySelector('[role="tab"][aria-selected="true"], [role="tab"].is-active, [class*="active"], [class*="selected"], [class*="current"]');
    if (attrActive) {
      const t = attrActive.textContent?.trim();
      if (t && t.length >= 2 && t.length <= 16 && !t.includes('\n')) return t;
    }
    const all = Array.from(document.querySelectorAll('div, li, button, span, a'));
    for (const el of all) {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        const text = el.textContent?.trim();
        if (text && text.length >= 2 && text.length <= 16 && !text.includes('\n')) {
          const tabInfo = findTabFromElement(el);
          if (tabInfo) {
            const s = window.getComputedStyle(el);
            if (parseInt(s.fontWeight, 10) >= 600 || s.borderBottomWidth !== '0px') {
              return text;
            }
          }
        }
      }
    }
    return '';
  }

  // 手动记录当前画面按钮
  btnRecordView.onclick = () => {
    const activeTabText = getActiveTabText();
    const pTitle = cleanPageTitle(document.title);
    const displayTitle = activeTabText ? `${pTitle} · ${activeTabText}` : `${pTitle} (视图)`;
    safeSendMessage({
      type: 'BATCH_RECORD_VIEW',
      url: window.location.href,
      title: displayTitle,
      tabText: activeTabText,
      forceSelect: true
    }).then(() => {
      showToast(`✓ 已将画面 [${displayTitle}] 记录到清单！`);
    });
  };

  // 启动/停止批量任务
  btnRunBatch.onclick = () => {
    if (currentBatchData.isExecuting) {
      safeSendMessage({ type: 'BATCH_STOP_EXECUTE' });
      showToast('正在停止批量任务…');
    } else {
      safeSendMessage({ type: 'BATCH_START_EXECUTE' }).then(res => {
        if (!res?.ok) showToast(res?.error || '无法启动批量任务');
      });
    }
  };

  // ── 智能感知 SPA 子菜单 / Tab 切换 ─────────────────────────────────
  window.addEventListener('click', (e) => {
    if (!currentBatchData.active) return;
    if (e.target.closest('#webfigma-helper')) return;

    const tabInfo = findTabFromElement(e.target);
    if (tabInfo && tabInfo.text) {
      lastDetectedTab = tabInfo.text;
      const rawText = tabInfo.text;
      const displayTitle = `${cleanPageTitle(document.title)} · ${rawText}`;
      setTimeout(() => {
        safeSendMessage({
          type: 'BATCH_RECORD_VIEW',
          url: window.location.href,
          title: displayTitle,
          tabText: rawText,
          forceSelect: false
        }).catch(() => {});
        showToast(`📋 已识别子菜单：${rawText}（已加入清单，待勾选）`, 3500);
      }, 250);
    }
  }, true);

  // 初始加载批量状态
  safeSendMessage({ type: 'BATCH_GET_DATA' }).then(res => {
    if (res?.ok) {
      renderBatchUI(res.active, res.list, res.isExecuting);
    }
  }).catch(() => {});

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
    if (m.type === 'STATUS') showToast(m.text, 5000);
    if (m.type === 'BATCH_STATE_UPDATED') {
      renderBatchUI(m.active, m.list, m.isExecuting);
    }
    if (m.type === 'TOGGLE_FLOATING_ICON') {
      host.style.display = m.show ? 'block' : 'none';
    }
    if (m.type === 'CAPTURE_UI') {
      if (m.hidden) {
        host.style.visibility = 'hidden';
        clearTimeout(visibilityTimer);
        visibilityTimer = setTimeout(show, 95000);
      } else show();
    }
    if (m.type === 'TASK_FINISHED') {
      show();
      captureBtn.disabled = false;
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
      showToast('请将鼠标悬停在需要定格的模块卡片或按钮上');
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
    showToast(`📌 原位定格 [${name}] (已锁定${count}个)！移开鼠标依然保持，正常随页面滚动；点大图标即可整页导出`);
  }

  // ── 常规整页捕获 ──────────────────────────────────────────────────
  captureBtn.onclick = async () => {
    if (suppressClick) return; // 拖动松开不触发捕获
    captureBtn.disabled = true;
    const count = window.__pagepickHoverEngine ? window.__pagepickHoverEngine.count() : 0;
    showToast(count > 0 
      ? `正在捕获包含 ${count} 个锁定 hover 态的整页…` 
      : '准备捕获…');
    try {
      const result = await safeSendMessage({ type: 'RUN_CAPTURE' });
      if (!result?.ok) showToast(result?.error || '操作失败');
    } catch (e) {
      showToast(e.message);
    } finally {
      host.style.visibility = 'visible';
      captureBtn.disabled = false;
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
      showToast('定格当前状态并导入 Figma…');
      safeSendMessage({ type: 'RUN_STATE_CAPTURE' }).then(result => {
        if (!result?.ok) showToast(result?.error || '操作失败');
      }).catch(err => {
        showToast(err.message);
      });
      return;
    }

    if (e.key === 'Escape') {
      if (window.__pagepickHoverEngine && window.__pagepickHoverEngine.count() > 0) {
        window.__pagepickHoverEngine.unlockAll();
        updateBadge();
        showToast('已清除所有定格状态');
      }
    }
  }, true);
})();
