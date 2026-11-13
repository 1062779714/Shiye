// figma-plugin/code.js  v3.1 — 拾页排列器：全容器内容智能检测 + 空画布自动归零 + 一键换行新启一行
figma.showUI(__html__, { width: 360, height: 490, themeColors: true });

const STATE_KEY = 'pagepick.placement.v3';

let running = true; // 默认永久保持运行
let gap = 500;
const processedIds = new Set();

// ── 持久状态（存储在当前页插件数据中）───────────────────────────
function loadState() {
  try {
    const raw = figma.currentPage.getPluginData(STATE_KEY);
    if (!raw) return { nextX: 0, currentY: 0, count: 0 };
    const s = JSON.parse(raw);
    return {
      nextX: Number.isFinite(s.nextX) ? s.nextX : 0,
      currentY: Number.isFinite(s.currentY) ? s.currentY : 0,
      count: Number.isFinite(s.count) ? s.count : 0
    };
  } catch (e) {}
  return { nextX: 0, currentY: 0, count: 0 };
}

function saveState(nextX, currentY, count) {
  figma.currentPage.setPluginData(STATE_KEY, JSON.stringify({ nextX, currentY, count }));
}

function progress(text) {
  figma.ui.postMessage({ type: 'STATUS', text });
}

function reply(requestId, result) {
  figma.ui.postMessage({ type: 'PAGEPICK_RESPONSE', requestId, result });
}

// ── 通用内容边界与画板检测（兼容 FRAME, SECTION, GROUP, COMPONENT 等一切容器）───────
function getContentBounds() {
  const page = figma.currentPage;
  // 找出当前页顶层所有可见、有尺寸的有效图层
  const topNodes = page.children.filter(n => n.visible !== false && n.width > 0 && n.height > 0);
  if (topNodes.length === 0) {
    return { hasContent: false, maxBottom: 0, maxX: 0, count: 0 };
  }

  let maxBottom = -Infinity;
  let maxX = -Infinity;

  for (const n of topNodes) {
    const bottom = n.y + n.height;
    const right = n.x + n.width;
    if (bottom > maxBottom) maxBottom = bottom;
    if (right > maxX) maxX = right;
  }

  return {
    hasContent: Number.isFinite(maxBottom),
    maxBottom: Math.round(maxBottom),
    maxX: Math.round(maxX),
    count: topNodes.length
  };
}

// ── 自动检测画布是否为空：若无任何内容自动归零重置 ───────────────────
function checkAndAutoResetIfEmpty() {
  const bounds = getContentBounds();
  if (!bounds.hasContent) {
    const state = loadState();
    if (state.nextX !== 0 || state.currentY !== 0) {
      saveState(0, 0, 0);
      processedIds.clear();
      const msg = '🟢 当前画布为空，已自动重置从 (X=0, Y=0) 开始';
      progress(msg);
      figma.ui.postMessage({
        type: 'ARRANGED_INFO',
        nextX: 0,
        currentY: 0,
        count: 0,
        text: msg,
        hasContent: false
      });
      return true;
    }
  }
  return false;
}

// ── 一键换行新启一行（已有内容最大高度 + gap，X从0开始）───────────────
function startNewRow() {
  const bounds = getContentBounds();
  let newY = 0;
  if (bounds.hasContent) {
    newY = bounds.maxBottom + gap;
  }

  const state = loadState();
  const currentCount = state.count || 0;
  saveState(0, newY, currentCount);

  const msg = bounds.hasContent
    ? `↵ 已换行：检测到已有内容(最大高 ${bounds.maxBottom}px)，下张从 (X=0, Y=${newY}) 开始`
    : `↵ 当前画布为空，下一张将从 (X=0, Y=0) 开始排列`;
  
  progress(msg);
  figma.notify(msg, { timeout: 3000 });

  figma.ui.postMessage({
    type: 'ARRANGED_INFO',
    nextX: 0,
    currentY: newY,
    count: currentCount,
    text: msg,
    hasContent: bounds.hasContent,
    maxBottom: bounds.maxBottom
  });
}

// ── 核心排列逻辑（原生坐标瞬间就位，绝不重复移动）─────────────────
let isArranging = false;

function arrangeNode(node) {
  if (!running || isArranging) return;
  if (!node || !node.id) return;
  if (processedIds.has(node.id)) return;

  const page = figma.currentPage;
  if (!node.parent || node.parent.id !== page.id) return;
  // 支持顶层直接粘贴的 FRAME 或普通画板
  if (node.type !== 'FRAME' && node.type !== 'SECTION' && node.type !== 'GROUP') return;
  if (node.width <= 0) return;

  isArranging = true;
  processedIds.add(node.id);

  try {
    const state = loadState();
    const targetX = state.nextX || 0;
    const targetY = state.currentY || 0;

    // 原生 API 瞬移坐标
    node.x = targetX;
    node.y = targetY;

    // 沿当前行向右递增
    const w = Math.round(node.width);
    const nextX = targetX + w + gap;
    const newCount = (state.count || 0) + 1;

    saveState(nextX, targetY, newCount);

    const msg = `✓ [第${newCount}张] X=${node.x} Y=${node.y} 宽=${w} → 下张X=${nextX}`;
    progress(msg);
    figma.notify(msg, { timeout: 3000 });

    const bounds = getContentBounds();
    figma.ui.postMessage({
      type: 'ARRANGED',
      x: node.x,
      y: node.y,
      width: w,
      nextX: nextX,
      currentY: targetY,
      count: newCount,
      hasContent: true,
      maxBottom: bounds.maxBottom
    });
  } catch (e) {
    processedIds.delete(node.id);
    progress('排列出错：' + e.message);
  } finally {
    isArranging = false;
  }
}

// ── 扫描检查入口 ──────────────────────────────────────────────────
function scanForNewFrames() {
  if (!running || isArranging) return;

  // 1. 优先通道：刚粘贴的内容 100% 会被 Figma 自动选中
  const selection = figma.currentPage.selection;
  for (const node of selection) {
    if (node && node.parent && node.parent.id === figma.currentPage.id) {
      if (node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP') {
        if (!processedIds.has(node.id)) {
          arrangeNode(node);
          return;
        }
      }
    }
  }

  // 2. 兜底通道：扫描当前页面顶层未处理过的画板
  const children = figma.currentPage.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i];
    if ((node.type === 'FRAME' || node.type === 'SECTION') && !processedIds.has(node.id)) {
      arrangeNode(node);
      return;
    }
  }
}

// ── 选区变更监听 ──────────────────────────────────────────────────
figma.on('selectionchange', () => {
  scanForNewFrames();
});

// ── 文档底层变更监听（必须在 loadAllPagesAsync 之后注册）─────────
function setupDocumentChangeListener() {
  try {
    figma.on('documentchange', (event) => {
      if (!running) return;
      for (const c of event.documentChanges) {
        if (c.type === 'CREATE') {
          const node = c.node || figma.getNodeById(c.id);
          if (node && node.parent && node.parent.id === figma.currentPage.id) {
            if (node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP') {
              if (!processedIds.has(node.id)) {
                arrangeNode(node);
                return;
              }
            }
          }
        } else if (c.type === 'DELETE') {
          // 删除了画板时，检查是否全部被清空
          checkAndAutoResetIfEmpty();
        }
      }
    });
  } catch (e) {
    console.warn('Document change listener warning:', e);
  }
}

// ── 用户切换 Figma 页面 (Page) 监听 ───────────────────────────────
figma.on('currentpagechange', () => {
  processedIds.clear();
  for (const child of figma.currentPage.children) {
    if (child.id) processedIds.add(child.id);
  }
  const wasEmpty = checkAndAutoResetIfEmpty();
  if (!wasEmpty) {
    const state = loadState();
    const bounds = getContentBounds();
    const msg = `已切换到 [${figma.currentPage.name}]（下张从 X=${state.nextX}, Y=${state.currentY} 开始）`;
    progress(msg);
    figma.ui.postMessage({
      type: 'ARRANGED_INFO',
      nextX: state.nextX,
      currentY: state.currentY,
      count: state.count,
      text: msg,
      hasContent: bounds.hasContent,
      maxBottom: bounds.maxBottom
    });
  }
});

// ── 轻量轮询守护（400ms）──────────────────────────────────────────
setInterval(() => {
  if (running) {
    scanForNewFrames();
  }
}, 400);

// ── 插件启动初始化 ────────────────────────────────────────────────
(async () => {
  try {
    for (const child of figma.currentPage.children) {
      if (child.id) processedIds.add(child.id);
    }
    await figma.loadAllPagesAsync();
    setupDocumentChangeListener();

    // 检查当前画布是否为空
    checkAndAutoResetIfEmpty();

    const state = loadState();
    const bounds = getContentBounds();
    const msg = bounds.hasContent
      ? `🟢 拾页排列器运行中（画布已有内容最大高 ${bounds.maxBottom}px，下张从 X=${state.nextX}, Y=${state.currentY} 开始）`
      : `🟢 拾页排列器运行中（当前画布为空，从 X=0, Y=0 开始）`;

    progress(msg);
    figma.ui.postMessage({
      type: 'PAGEPICK_RESPONSE',
      result: {
        running: true,
        nextX: state.nextX,
        currentY: state.currentY,
        gap,
        hasContent: bounds.hasContent,
        maxBottom: bounds.maxBottom
      }
    });
  } catch (e) {
    progress('初始化提示：' + e.message);
  }
})();

// ── UI 交互指令处理 ───────────────────────────────────────────────
figma.ui.onmessage = (m) => {
  if (!m || m.type !== 'PAGEPICK_REQUEST') return;
  const { command, requestId } = m;

  try {
    const page = figma.currentPage;
    const state = loadState();
    const bounds = getContentBounds();

    if (command === 'PING') {
      reply(requestId, {
        ok: true,
        version: '3.1.0',
        running: true,
        pageId: page.id,
        pageName: page.name,
        nextX: state.nextX,
        currentY: state.currentY,
        gap,
        hasContent: bounds.hasContent,
        maxBottom: bounds.maxBottom
      });
      return;
    }

    if (command === 'SET_GAP') {
      const g = Number.isInteger(m.gap) && m.gap >= 0 && m.gap <= 10000 ? m.gap : 500;
      gap = g;
      progress(`已更新画板横向间隔为 ${gap}px`);
      reply(requestId, { ok: true, gap });
      return;
    }

    // 核心指令：一键换行新启一行
    if (command === 'NEW_ROW') {
      startNewRow();
      reply(requestId, { ok: true });
      return;
    }

    // 重置指令：强制回到 (0, 0)
    if (command === 'RESET') {
      page.setPluginData(STATE_KEY, '');
      saveState(0, 0, 0);
      const msg = '已重置序列；下一次新粘贴将从 (X=0, Y=0) 开始';
      progress(msg);
      figma.notify(msg, { timeout: 3000 });
      reply(requestId, { ok: true });
      figma.ui.postMessage({
        type: 'ARRANGED_INFO',
        nextX: 0,
        currentY: 0,
        count: 0,
        text: msg,
        hasContent: false
      });
      return;
    }

    reply(requestId, { ok: false, error: '未知命令: ' + command });
  } catch (e) {
    progress(e.message);
    reply(requestId, { ok: false, error: e.message });
  }
};
