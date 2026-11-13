// figma-plugin/code.js  v2.1 — 选区改变 + 文档变更 + 轮询 三重实时捕获排列
figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

const STATE_KEY = 'pagepick.placement.v2';

let running = true; // 开箱即用：默认直接启动监听排列，无需手动点击开启
let gap = 500;
const processedIds = new Set();

// ── 持久状态（存在当前页插件数据里）─────────────────────────────
function loadState() {
  try {
    const raw = figma.currentPage.getPluginData(STATE_KEY);
    if (!raw) return { nextX: 0, count: 0 };
    const s = JSON.parse(raw);
    if (Number.isFinite(s.nextX)) return s;
  } catch (e) {}
  return { nextX: 0, count: 0 };
}

function saveState(nextX, count) {
  figma.currentPage.setPluginData(STATE_KEY, JSON.stringify({ nextX, count }));
}

function progress(text) {
  figma.ui.postMessage({ type: 'STATUS', text });
}

function reply(requestId, result) {
  figma.ui.postMessage({ type: 'PAGEPICK_RESPONSE', requestId, result });
}

// ── 核心排列逻辑（幂等，绝不重复移动）─────────────────────────────
let isArranging = false;

function arrangeNode(node) {
  if (!running || isArranging) return;
  if (!node || !node.id) return;
  if (processedIds.has(node.id)) return;

  // 必须是当前页顶层的 FRAME
  const page = figma.currentPage;
  if (!node.parent || node.parent.id !== page.id) return;
  if (node.type !== 'FRAME') return;

  // 避免未完成渲染时读取到 0 宽
  if (node.width <= 0) return;

  isArranging = true;
  processedIds.add(node.id);

  try {
    const state = loadState();
    const targetX = state.nextX;
    const targetY = 0;

    // 设置坐标
    node.x = targetX;
    node.y = targetY;

    // 计算下一个画板的 X 坐标
    const w = Math.round(node.width);
    const nextX = targetX + w + gap;
    const newCount = (state.count || 0) + 1;

    saveState(nextX, newCount);

    const msg = `✓ [第${newCount}张] X=${node.x} Y=${node.y} 宽=${w} → 下张X=${nextX}`;
    progress(msg);
    figma.notify(msg, { timeout: 3000 });

    figma.ui.postMessage({
      type: 'ARRANGED',
      x: node.x,
      y: node.y,
      width: w,
      nextX: nextX,
      count: newCount
    });
  } catch (e) {
    processedIds.delete(node.id); // 失败允许重试
    progress('排列出错：' + e.message);
  } finally {
    isArranging = false;
  }
}

// ── 扫描检查入口 ──────────────────────────────────────────────────
function scanForNewFrames() {
  if (!running || isArranging) return;

  // 优先通道 1：刚粘贴的内容 100% 会被 Figma 自动选中
  const selection = figma.currentPage.selection;
  for (const node of selection) {
    if (node && node.parent && node.parent.id === figma.currentPage.id && node.type === 'FRAME') {
      if (!processedIds.has(node.id)) {
        arrangeNode(node);
        return;
      }
    }
  }

  // 兜底通道 2：扫描当前页面顶层所有未处理过的 FRAME
  const children = figma.currentPage.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i];
    if (node.type === 'FRAME' && !processedIds.has(node.id)) {
      arrangeNode(node);
      return;
    }
  }
}

// ── 事件监听：选区变化（粘贴时最先且必然触发）───────────────────
figma.on('selectionchange', () => {
  scanForNewFrames();
});

// ── 事件监听：文档变更（低级底层事件）─────────────────────────────
function setupDocumentChangeListener() {
  figma.on('documentchange', (event) => {
    if (!running) return;
    for (const c of event.documentChanges) {
      if (c.type === 'CREATE') {
        const node = c.node || figma.getNodeById(c.id);
        if (node && node.parent && node.parent.id === figma.currentPage.id && node.type === 'FRAME') {
          if (!processedIds.has(node.id)) {
            arrangeNode(node);
            return;
          }
        }
      }
    }
  });
}

// ── 轻量轮询守护（每 400ms 检查一次，无缝补刀）──────────────────
setInterval(() => {
  if (running) {
    scanForNewFrames();
  }
}, 400);

// ── 初始化 ────────────────────────────────────────────────────────
(async () => {
  try {
    // 标记当前页面已有的所有老画板，避免开启自动排列后把用户原有的老图层误移
    for (const child of figma.currentPage.children) {
      if (child.id) processedIds.add(child.id);
    }

    await figma.loadAllPagesAsync();
    setupDocumentChangeListener();
    const state = loadState();
    progress(`🟢 自动排列运行中（间隔 ${gap}px，下张从 X=${state.nextX} 开始）`);
    figma.ui.postMessage({ type: 'PAGEPICK_RESPONSE', result: { running: true, nextX: state.nextX, gap } });
  } catch (e) {
    progress('初始化提示：' + e.message);
  }
})();

// ── UI 消息交互 ───────────────────────────────────────────────────
figma.ui.onmessage = (m) => {
  if (!m || m.type !== 'PAGEPICK_REQUEST') return;
  const { command, requestId } = m;

  try {
    const page = figma.currentPage;
    const state = loadState();

    if (command === 'PING') {
      reply(requestId, {
        ok: true,
        version: '2.1.0',
        running,
        pageId: page.id,
        pageName: page.name,
        nextX: state.nextX,
        gap
      });
      return;
    }

    if (command === 'START') {
      const g = Number.isInteger(m.gap) && m.gap >= 0 && m.gap <= 10000 ? m.gap : 500;
      gap = g;
      running = true;

      // 开启时，再次把当前页面已有所有画板加入已处理名单，确保只移动新粘贴进来的
      for (const child of page.children) {
        if (child.id) processedIds.add(child.id);
      }

      progress(`✓ 自动排列运行中（间隔 ${gap}px，下张从 X=${state.nextX} 开始）`);
      reply(requestId, { ok: true, running: true, nextX: state.nextX });
      return;
    }

    if (command === 'STOP') {
      running = false;
      progress('已暂停自动排列');
      reply(requestId, { ok: true });
      return;
    }

    if (command === 'RESET') {
      running = false;
      page.setPluginData(STATE_KEY, '');
      progress('已重置记录；下一次新粘贴将从 (X=0, Y=0) 开始');
      reply(requestId, { ok: true });
      return;
    }

    reply(requestId, { ok: false, error: '未知命令: ' + command });
  } catch (e) {
    progress(e.message);
    reply(requestId, { ok: false, error: e.message });
  }
};
