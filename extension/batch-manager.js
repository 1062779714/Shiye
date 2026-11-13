/**
 * batch-manager.js — 批量采集任务控制器
 * 负责自动记账跟踪、清单持久化、后台多网页批量导航、聚焦激活、流式捕获与 Figma 自动排列。
 */

(() => {
  let isExecuting = false;
  let cancelRequested = false;

  // 提取干净简洁的网页简称
  function cleanTitle(fullTitle) {
    if (!fullTitle) return '未命名页面';
    const firstPart = fullTitle.split(/[-_|–—]/)[0].trim();
    return firstPart || fullTitle.slice(0, 20);
  }

  // 极简规则：清单只保留所有已勾选的页面 + 当前正浏览的这一个未勾选页面
  function updateCurrentPageInList(list, newItem) {
    if (!Array.isArray(list)) list = [];
    // 1. 保留所有用户已勾选、正在采集中或成功的页面
    const keptList = list.filter(item => item.selected || item.status === 'running' || item.status === 'success');

    // 2. 检查新页面是否已经是已选保留项
    const sameKept = keptList.find(x => x.url === newItem.url && (x.tabText || '') === (newItem.tabText || ''));
    if (sameKept) {
      if (newItem.selected) sameKept.selected = true;
      return keptList;
    }

    // 3. 追加当前页面（唯一的待勾选项）到末尾
    keptList.push(newItem);
    return keptList;
  }

  // 获取当前存储
  async function getBatchState() {
    const data = await chrome.storage.local.get(['batchModeActive', 'batchList']);
    return {
      active: !!data.batchModeActive,
      list: Array.isArray(data.batchList) ? data.batchList : []
    };
  }

  // 保存存储并向所有标签页广播
  async function saveBatchState(active, list) {
    await chrome.storage.local.set({
      batchModeActive: active,
      batchList: list
    });
    // 广播通知所有标签页刷新悬浮面板
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: 'BATCH_STATE_UPDATED',
          active,
          list,
          isExecuting
        }).catch(() => {});
      }
    } catch {}
  }

  // 1. 监听网页加载/跳转，自动记账加入待采清单（默认不选中）
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const isComplete = changeInfo.status === 'complete';
    const isUrlChange = !!changeInfo.url;
    if (!isComplete && !isUrlChange) return;

    const currentUrl = tab.url || changeInfo.url;
    if (!currentUrl || (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://'))) return;
    if (currentUrl.includes('figma.com/')) return; // 忽略 Figma 设计文件本身

    let { active, list } = await getBatchState();
    if (!active || isExecuting) return;

    const newItem = {
      id: 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      url: currentUrl,
      title: cleanTitle(tab.title),
      tabText: '',
      selected: false, // 默认等待勾选状态
      status: 'pending'
    };
    const updatedList = updateCurrentPageInList(list, newItem);
    await saveBatchState(active, updatedList);
  });

  // 2. 监听标签页切换，自动记账当前激活的网页（默认不选中）
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    let { active, list } = await getBatchState();
    if (!active || isExecuting) return;
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (!tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return;
      if (tab.url.includes('figma.com/')) return;
      const newItem = {
        id: 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        url: tab.url,
        title: cleanTitle(tab.title),
        tabText: '',
        selected: false,
        status: 'pending'
      };
      const updatedList = updateCurrentPageInList(list, newItem);
      await saveBatchState(active, updatedList);
    } catch {}
  });

  // 3. 核心：顺序执行批量采集任务
  async function executeBatchTasks(tabId) {
    if (isExecuting) return { ok: false, error: '批量任务已在运行中' };

    const state = await getBatchState();
    const toRun = state.list.filter(item => item.selected && item.status !== 'success');
    if (toRun.length === 0) return { ok: false, error: '没有需要采集的选中页面' };

    isExecuting = true;
    cancelRequested = false;
    await saveBatchState(state.active, state.list);

    try {
      for (let i = 0; i < toRun.length; i++) {
        if (cancelRequested) break;

        const currentItem = toRun[i];
        // 标记当前项为 running
        currentItem.status = 'running';
        await saveBatchState(state.active, state.list);

        try {
          // 步骤 A: 激活浏览器窗口，使 document.hasFocus() 成立（解决粘贴到 Figma 导致浏览器失焦而使剪贴板报错的问题）
          await chrome.runtime.sendNativeMessage('com.webfigma.helper', { action: 'focusBrowser' }).catch(() => {});
          const tabObjBefore = await chrome.tabs.get(tabId);
          if (tabObjBefore.windowId) {
            await chrome.windows.update(tabObjBefore.windowId, { focused: true }).catch(() => {});
          }
          await chrome.tabs.update(tabId, { active: true }).catch(() => {});

          // 步骤 B: 页面网址不同时执行导航并等待加载完成
          if (tabObjBefore.url !== currentItem.url) {
            await chrome.tabs.update(tabId, { url: currentItem.url });
            
            await new Promise((resolve) => {
              const listener = (tid, change) => {
                if (tid === tabId && change.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }
              };
              chrome.tabs.onUpdated.addListener(listener);
              setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(); // 超时也尝试继续
              }, 25000);
            });

            // 额外缓冲 1.5 秒等待首屏和异步渲染就绪
            await new Promise(r => setTimeout(r, 1500));
          }

          // 再次确保浏览器窗口与页面拥有焦点
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              window.focus();
              if (document.body) document.body.focus();
            }
          }).catch(() => {});

          // 步骤 C: 如果属于子菜单/Tab 切换项目，在页面中触发对应的 Tab 点击
          if (currentItem.tabText) {
            await chrome.scripting.executeScript({
              target: { tabId },
              func: (text) => {
                const candidates = Array.from(document.querySelectorAll('[role="tab"], .tea-tabs__header-item, .ant-tabs-tab, .el-tabs__item, .t-tabs__item, button, a, li, span, div'));
                let found = candidates.find(el => {
                  return (el.getAttribute('role') === 'tab' || el.className?.includes?.('tab') || el.tagName === 'BUTTON' || el.tagName === 'LI')
                    && el.textContent?.trim() === text && el.offsetWidth > 0;
                });
                if (!found) {
                  found = candidates.find(el => el.textContent?.trim() === text && el.offsetWidth > 0);
                }
                if (found) {
                  found.click();
                  return true;
                }
                return false;
              },
              args: [currentItem.tabText]
            }).catch(() => {});
            // 等待 Tab 内容切换渲染完成
            await new Promise(r => setTimeout(r, 1000));
          }

          // 步骤 D: 执行单页捕获与 Figma 粘贴导入（复用已验证的 run 函数）
          const tabObj = await chrome.tabs.get(tabId);
          const capResult = await run(tabObj);

          if (capResult && capResult.ok) {
            currentItem.status = 'success';
            delete currentItem.error;
          } else {
            currentItem.status = 'failed';
            currentItem.error = capResult?.error || '捕获未确认';
          }
        } catch (err) {
          currentItem.status = 'failed';
          currentItem.error = err.message || '捕获失败';
        }

        await saveBatchState(state.active, state.list);
        // 间隔 1.2 秒给 Figma 插件自动排列留出时间
        await new Promise(r => setTimeout(r, 1200));
      }

      return { ok: true, completed: true };
    } finally {
      isExecuting = false;
      cancelRequested = false;
      const latest = await getBatchState();
      await saveBatchState(latest.active, latest.list);
    }
  }

  // 消息分发处理
  globalThis.handleBatchMessages = async function(m, sender) {
    let { active, list } = await getBatchState();

    if (m.type === 'BATCH_GET_DATA') {
      return { ok: true, active, list, isExecuting };
    }

    if (m.type === 'BATCH_TOGGLE_MODE') {
      const newActive = (typeof m.forceActive === 'boolean') ? m.forceActive : !active;
      const url = m.url || sender?.tab?.url;
      const title = m.title || cleanTitle(sender?.tab?.title);
      if (newActive && url && !url.includes('figma.com/')) {
        const newItem = {
          id: 'b-' + Date.now(),
          url: url,
          title: title || '当前页面',
          tabText: m.tabText || '',
          selected: false, // 默认等待勾选状态
          status: 'pending'
        };
        list = updateCurrentPageInList(list, newItem);
      }
      await saveBatchState(newActive, list);
      return { ok: true, active: newActive, list, isExecuting };
    }

    // 记录 SPA 子菜单/Tab 切换或者手动记录当前画面
    if (m.type === 'BATCH_RECORD_VIEW') {
      const url = m.url || sender?.tab?.url;
      const title = m.title || cleanTitle(sender?.tab?.title);
      const tabText = m.tabText || '';

      if (url && !url.includes('figma.com/')) {
        // 如果是手动点击“+ 记录当前画面”，查找当前项并强制勾选
        if (m.forceSelect) {
          const currentItem = {
            id: 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            url: url,
            title: title || tabText || '当前页面',
            tabText: tabText,
            selected: true,
            status: 'pending'
          };
          // 如果列表中已有该项，更新其状态为勾选
          const exists = list.find(x => x.url === url && (x.tabText || '') === tabText);
          if (exists) {
            exists.selected = true;
            if (title) exists.title = title;
          } else {
            list = updateCurrentPageInList(list, currentItem);
          }
        } else {
          // 浏览切换：上一个未勾选的自动替换为当前新项目
          const currentItem = {
            id: 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            url: url,
            title: title || tabText || '当前页面',
            tabText: tabText,
            selected: false, // 待勾选状态
            status: 'pending'
          };
          list = updateCurrentPageInList(list, currentItem);
        }
        await saveBatchState(active, list);
      }
      return { ok: true, active, list, isExecuting };
    }

    if (m.type === 'BATCH_TOGGLE_ITEM') {
      const target = list.find(x => x.id === m.id);
      if (target) {
        target.selected = (typeof m.selected === 'boolean') ? m.selected : !target.selected;
        await saveBatchState(active, list);
      }
      return { ok: true, list };
    }

    if (m.type === 'BATCH_TOGGLE_ALL') {
      const allSelected = list.every(x => x.selected);
      list.forEach(x => x.selected = !allSelected);
      await saveBatchState(active, list);
      return { ok: true, list };
    }

    if (m.type === 'BATCH_REMOVE_ITEM') {
      const idx = list.findIndex(x => x.id === m.id);
      if (idx !== -1) {
        list.splice(idx, 1);
        await saveBatchState(active, list);
      }
      return { ok: true, list };
    }

    if (m.type === 'BATCH_CLEAR_ALL') {
      await saveBatchState(active, []);
      return { ok: true, list: [] };
    }

    if (m.type === 'BATCH_NAVIGATE') {
      const tabId = sender?.tab?.id;
      if (tabId && m.url) {
        await chrome.tabs.update(tabId, { url: m.url });
      }
      return { ok: true };
    }

    if (m.type === 'BATCH_START_EXECUTE') {
      const tabId = sender?.tab?.id;
      if (!tabId) throw Error('无法识别执行标签页');
      executeBatchTasks(tabId).catch(err => {
        console.error('Batch execution error:', err);
      });
      return { ok: true, started: true };
    }

    if (m.type === 'BATCH_STOP_EXECUTE') {
      cancelRequested = true;
      return { ok: true };
    }

    if (m.type === 'BATCH_RETRY_ITEM') {
      const target = list.find(x => x.id === m.id);
      if (target) {
        target.status = 'pending';
        target.selected = true;
        delete target.error;
        await saveBatchState(active, list);
      }
      return { ok: true, list };
    }

    return null;
  };
})();