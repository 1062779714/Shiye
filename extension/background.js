importScripts('placement.js','plugin-bridge.js','batch-manager.js');
const tasks = new Set();
async function injectButtons() {
  const tabs=await chrome.tabs.query({url:['http://*/*','https://*/*']});
  await Promise.allSettled(tabs.map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']})));
}
async function initDefaults() {
  const defaults = {
    mode: 'desktop',
    pasteMethod: 'native',
    placementEngine: 'native',
    frameGap: 500,
    showFloatingIcon: true
  };
  const existing = await chrome.storage.local.get(Object.keys(defaults));
  const toSet = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (existing[k] === undefined) {
      toSet[k] = v;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  await initDefaults();
  await injectButtons();
});
chrome.runtime.onStartup.addListener(async () => {
  await initDefaults();
  await injectButtons();
});
async function placementStorageKey(tab) {
  const url=new URL(tab.url);
  const file=url.pathname.split('/').slice(0,3).join('/');
  const indexKey=`placement-page:${file}`;
  const last=(await chrome.storage.local.get(indexKey))[indexKey];
  const page=url.searchParams.get('page-id') || last || 'default';
  // Figma can remove page-id while changing node-id. Keep the last page scope rather than starting a new sequence.
  if(url.searchParams.has('page-id'))await chrome.storage.local.set({[indexKey]:page});
  return `placement-origin:${file}:${page}`;
}
async function reloadSource(tabId) {
  await new Promise((resolve,reject)=>{
    let reloaded=false;
    const cleanup=()=>{clearTimeout(timer);chrome.tabs.onUpdated.removeListener(updated);chrome.tabs.onRemoved.removeListener(removed);};
    const updated=(id,change)=>{if(id===tabId && change.status==='complete' && reloaded){cleanup();resolve();}};
    const removed=id=>{if(id===tabId){cleanup();reject(Error('来源网页已关闭'));}};
    const timer=setTimeout(()=>{cleanup();reject(Error('刷新网页超时，请检查网页是否正常加载'));},60000);
    chrome.tabs.onUpdated.addListener(updated);chrome.tabs.onRemoved.addListener(removed);
    reloaded=true;
    chrome.tabs.reload(tabId).catch(error=>{cleanup();reject(error);});
  });
  await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.type && m.type.startsWith('BATCH_')) {
    if (globalThis.handleBatchMessages) {
      globalThis.handleBatchMessages(m, sender)
        .then(res => reply(res))
        .catch(err => reply({ ok: false, error: err.message }));
      return true;
    }
  }
  if(m.type==='RESET_PLACEMENT'){
    (async()=>{
      if(tasks.has(`target:${m.tabId}`))throw Error('当前仍在捕获或排列，请完成后再重置');
      const {placementEngine}=await chrome.storage.local.get('placementEngine');
      if(placementEngine!=='off')return await callFigmaArranger(m.tabId,'RESET');
      const tab=await chrome.tabs.get(m.tabId),url=new URL(tab.url);
      if(!/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(tab.url))throw Error('请选择 Figma 设计文件');
      const key=await placementStorageKey(tab);
      await chrome.storage.local.remove(key);return {ok:true};
    })().then(reply,error=>reply({ok:false,error:error.message}));return true;
  }
  if(m.type==='CHECK_ARRANGER'){callFigmaArranger(m.tabId,'PING').then(reply,error=>reply({ok:false,error:error.message}));return true;}
  if(m.type==='CHECK_HELPER'){chrome.runtime.sendNativeMessage('com.webfigma.helper',{action:'ping'}).then(reply,error=>reply({ok:false,error:error.message}));return true;}
  if (m.type === 'RUN_STATE_CAPTURE') {
    captureCurrentState(sender.tab).then(result => { try { reply(result); } catch {} }, async e => {
      if (sender.tab?.id) await status(sender.tab.id, e.message);
      try { reply({ ok: false, error: e.message }); } catch {}
    });
    return true;
  }
  if (m.type === 'RUN_CAPTURE') {
    // The source document is replaced by reload; publish failures to its new content script as well.
    run(sender.tab).then(result=>{try {reply(result);}catch{}}, async e => {
      if(sender.tab?.id)await status(sender.tab.id,e.message);
      try {reply({ok:false,error:e.message});}catch{}
    });
    return true;
  }
  if (m.cmd) {
    support(m, sender).then(value => reply({success:true,value}), e => reply({success:false,error:e.message}));
    return true;
  }
});
async function support(m, sender) {
  if (m.cmd === 'H2D_CAPTURE_VISIBLE_TAB') return ''; // Preview is unnecessary for clipboard export.
  if (m.cmd === 'TRACK' || m.cmd === 'SENTRY_EXCEPTION') return;
  if (m.cmd === 'H2D_FETCH_ASSETS') {
    return Promise.all(m.payload.urls.map(async url => {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) throw Error('Unsupported asset URL');
        const response = await fetch(url, {signal:AbortSignal.timeout(5000),cache:'force-cache',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
        if (!response.ok) throw Error('Asset request failed');
        const type=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if(!type.startsWith('image/'))throw Error('Not an image');
        if(Number(response.headers.get('content-length'))>10485760)throw Error('Asset too large');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if(bytes.length>10485760)throw Error('Asset too large');
        let binary = '';
        for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
        return {url,blob:{type,base64Blob:`data:${type};base64,${btoa(binary)}`}};
      } catch { return {url,blob:null,error:'recovery_failed'}; }
    }));
  }
  throw Error(`Unsupported capture request: ${m.cmd}`);
}
async function status(id, text) {
  await chrome.tabs.sendMessage(id,{type:'STATUS',text}).catch(()=>{});
}
async function run(source) {
  if (!source?.id) throw Error('无法识别来源网页');
  if (tasks.has(source.id)) throw Error('当前页面正在捕获');
  const config = await chrome.storage.local.get(['mode','targetTabId','clientTitle','captureWidth','pasteMethod','placementEngine']);
  const mode = config.mode || 'desktop';
  const pasteMethod = config.pasteMethod || 'native';
  if (pasteMethod !== 'manual' && mode === 'web') {
    if (!Number.isInteger(config.targetTabId) || config.targetTabId < 0) {
      throw Error('请先点击浏览器工具栏中的扩展图标，绑定目标 Figma 文件');
    }
    const target = await chrome.tabs.get(config.targetTabId).catch(()=>null);
    if (!target || !/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(target.url || '')) throw Error('请先在扩展设置中绑定 Figma 文件标签页');
    if(config.placementEngine!=='off'){const connected=await callFigmaArranger(config.targetTabId,'PING');if(!connected?.ok)throw Error(connected?.error || '请先启动拾页排列器');}
    if (target.id === source.id) throw Error('请在需要捕获的网页上操作');
  }
  const targetLock=pasteMethod==='manual'?`manual:${source.id}`:`target:${mode==='desktop'?'desktop':config.targetTabId}`;
  if(tasks.has(targetLock))throw Error('目标 Figma 正在处理上一张画板，请完成后再试');
  tasks.add(targetLock);
  tasks.add(source.id);
  let stage='准备捕获',progressTimer;
  const timings={},started=Date.now();
  let viewportAttached=false;
  const restoreViewport=async()=>{};
  try {
    let result;
    for(let attempt=0;attempt<2;attempt++) {
      try {
    stage='准备捕获';
    await status(source.id,'准备加载完整内容…');
    await chrome.tabs.update(source.id,{active:true});
    if (source.windowId) await chrome.windows.update(source.windowId,{focused:true}).catch(()=>{});
    // 彻底释放可能残留的 debugger，杜绝 Aside 浏览器白屏与调试横幅
    await chrome.debugger.detach({tabId:source.id}).catch(()=>{});
    await status(source.id,'正在滚动页面，加载完整内容…');
    const [preload] = await chrome.scripting.executeScript({
      target:{tabId:source.id},func:preloadPage
    });
    if (preload.result?.limited) {
      throw Error('页面过长或持续加载，已停止滚动。请缩小采集范围后重试');
    }
    await status(source.id,'页面加载完成，捕获中…');
    const [loaded] = await chrome.scripting.executeScript({target:{tabId:source.id},func:()=>!!globalThis.__webFigmaCaptureLoaded});
    if (!loaded.result) {
      await chrome.scripting.executeScript({target:{tabId:source.id},files:['vendor/capture.js']});
      await chrome.scripting.executeScript({target:{tabId:source.id},func:()=>{globalThis.__webFigmaCaptureLoaded=true;}});
    }
    stage='生成 Figma 图层与剪贴板数据';
    const captureStarted=Date.now();
    progressTimer=setInterval(()=>status(source.id,`正在处理页面结构、图片及图层数据… ${Math.floor((Date.now()-captureStarted)/1000)} 秒`),1000);

    await chrome.tabs.sendMessage(source.id,{type:'CAPTURE_UI',hidden:true}).catch(()=>{});

    // 捕获前：左右两侧内容全展开，不固定左侧菜单高度，自动取两侧最大内容高度
    await chrome.scripting.executeScript({
      target: { tabId: source.id },
      args: [config.captureWidth || 0],
      func: (targetW) => {
        window.__webFigmaPrecisionRestores = [];

        // 0. 自动清洗页面现存的所有非法 nan SVG 路径，从根源上杜绝浏览器内核报错
        try {
          const badPaths = document.querySelectorAll('path[d*="nan" i]');
          for (const p of badPaths) p.removeAttribute('d');
        } catch (_) {}

        // 1. 处理右侧小悬浮挂件（如客服/反馈条）：提升至 body 并定位至整页真实右下角，杜绝飞出画板或悬在页面中间
        window.__webFigmaFloatingRestores = [];
        const allFixed = document.querySelectorAll('*');
        for (const el of allFixed) {
          if (el.id === 'webfigma-helper' || el.closest('#webfigma-helper')) continue;
          const s = window.getComputedStyle(el);
          if (s.position === 'fixed') {
            const r = el.getBoundingClientRect();
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            // 匹配右侧常驻小挂件（非全屏遮罩/非导航栏）
            if (w > 15 && w < 140 && h > 40 && h < 650 && r.right > window.innerWidth - 140) {
              window.__webFigmaFloatingRestores.push({
                el,
                parent: el.parentElement,
                nextSibling: el.nextSibling,
                position: el.style.position,
                top: el.style.top,
                bottom: el.style.bottom,
                right: el.style.right,
                zIndex: el.style.zIndex,
                height: el.style.height,
                maxHeight: el.style.maxHeight
              });
              // 挂载至 body 顶层，并以绝对定位吸附在长画板的右下角
              document.body.appendChild(el);
              el.style.setProperty('position', 'absolute', 'important');
              el.style.setProperty('top', 'auto', 'important');
              el.style.setProperty('bottom', '32px', 'important');
              el.style.setProperty('right', '20px', 'important');
              el.style.setProperty('height', h + 'px', 'important');
              el.style.setProperty('max-height', h + 'px', 'important');
              el.style.setProperty('z-index', '99999', 'important');
            }
          }
        }

        // 2. 寻找右侧真正的大内容滚动容器
        let best = null, maxDiff = 0;
        const all = document.querySelectorAll('*');
        for (const el of all) {
          if (el.matches('aside, nav, [role="navigation"], .tea-layout__side, [class*="side" i], [class*="menu" i]')) continue;
          if (el.closest('aside, nav, [role="navigation"], .tea-layout__side, [class*="side" i]')) continue;
          const diff = el.scrollHeight - el.clientHeight;
          if (diff > 80 && el.clientHeight > 180) {
            const s = window.getComputedStyle(el);
            if (['auto', 'scroll'].includes(s.overflowY)) {
              if (diff > maxDiff) { maxDiff = diff; best = el; }
            }
          }
        }

        // 3. 计算右侧内容实际高度
        let detectedRightH = 0;
        if (best) {
          detectedRightH = best.scrollHeight;
          try {
            let maxChildBottom = 0;
            const bRect = best.getBoundingClientRect();
            for (const child of best.querySelectorAll('*')) {
              const cs = window.getComputedStyle(child);
              if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
              const cr = child.getBoundingClientRect();
              if (cr.width > 0 && cr.height > 0) {
                const relB = (cr.bottom - bRect.top) + best.scrollTop;
                if (relB > maxChildBottom) maxChildBottom = relB;
              }
            }
            if (maxChildBottom > 0) detectedRightH = Math.ceil(maxChildBottom) + 16;
          } catch (e) {}
        }

        // 4. 左侧菜单栏不固定高度，全量解封展开，并计算其真实高度
        let detectedLeftH = 0;
        const sidebars = document.querySelectorAll('aside, nav, [role="navigation"], .tea-layout__side, [class*="side" i], [class*="menu" i]');
        for (const sb of sidebars) {
          const s = window.getComputedStyle(sb);
          if (s.display === 'none' || s.visibility === 'hidden') continue;
          if (sb.offsetHeight > 80) {
            window.__webFigmaPrecisionRestores.push({
              el: sb,
              height: sb.style.height,
              maxHeight: sb.style.maxHeight,
              minHeight: sb.style.minHeight,
              overflow: sb.style.overflow,
              overflowY: sb.style.overflowY
            });
            sb.style.setProperty('height', 'auto', 'important');
            sb.style.setProperty('max-height', 'none', 'important');
            sb.style.setProperty('overflow', 'visible', 'important');
            sb.style.setProperty('overflow-y', 'visible', 'important');

            const sbRect = sb.getBoundingClientRect();
            let maxSbBottom = sb.scrollHeight;
            for (const child of sb.querySelectorAll('*')) {
              const cs = window.getComputedStyle(child);
              if (['auto', 'scroll'].includes(cs.overflowY) || ['auto', 'scroll'].includes(cs.overflow)) {
                window.__webFigmaPrecisionRestores.push({
                  el: child,
                  height: child.style.height,
                  maxHeight: child.style.maxHeight,
                  overflow: child.style.overflow,
                  overflowY: child.style.overflowY
                });
                child.style.setProperty('height', 'auto', 'important');
                child.style.setProperty('max-height', 'none', 'important');
                child.style.setProperty('overflow', 'visible', 'important');
                child.style.setProperty('overflow-y', 'visible', 'important');
              }
              const cr = child.getBoundingClientRect();
              if (cr.width > 0 && cr.height > 0) {
                const relB = (cr.bottom - sbRect.top) + sb.scrollTop;
                if (relB > maxSbBottom) maxSbBottom = relB;
              }
            }
            if (maxSbBottom > detectedLeftH) detectedLeftH = Math.ceil(maxSbBottom) + 16;
          }
        }

        // 5. 整体高度：取左右两侧真实内容与视口的最大值，严丝合缝
        const contentMaxH = Math.max(detectedRightH, detectedLeftH, window.innerHeight);
        const bestTop = best ? Math.max(0, best.getBoundingClientRect().top) : 0;
        const totalPageH = Math.max(window.innerHeight, contentMaxH + Math.ceil(bestTop));

        // 6. 将 best 容器本身设为精准内容高度，解除内部滚动条
        if (best) {
          window.__webFigmaPrecisionRestores.push({
            el: best,
            height: best.style.height,
            maxHeight: best.style.maxHeight,
            minHeight: best.style.minHeight,
            overflow: best.style.overflow,
            overflowY: best.style.overflowY
          });
          best.style.setProperty('height', detectedRightH + 'px', 'important');
          best.style.setProperty('min-height', detectedRightH + 'px', 'important');
          best.style.setProperty('max-height', 'none', 'important');
          best.style.setProperty('overflow', 'visible', 'important');
          best.style.setProperty('overflow-y', 'visible', 'important');

          // 解封 best 的父链
          let curr = best.parentElement;
          while (curr && curr !== document) {
            window.__webFigmaPrecisionRestores.push({
              el: curr,
              height: curr.style.height,
              maxHeight: curr.style.maxHeight,
              minHeight: curr.style.minHeight,
              overflow: curr.style.overflow,
              overflowY: curr.style.overflowY
            });
            curr.style.setProperty('height', totalPageH + 'px', 'important');
            curr.style.setProperty('min-height', totalPageH + 'px', 'important');
            curr.style.setProperty('max-height', 'none', 'important');
            curr.style.setProperty('overflow', 'visible', 'important');
            curr.style.setProperty('overflow-y', 'visible', 'important');
            curr = curr.parentElement;
          }
        }

        // 7. 解封 html 和 body
        for (const rootEl of [document.documentElement, document.body]) {
          if (rootEl) {
            window.__webFigmaPrecisionRestores.push({
              el: rootEl,
              height: rootEl.style.height,
              maxHeight: rootEl.style.maxHeight,
              minHeight: rootEl.style.minHeight,
              overflow: rootEl.style.overflow,
              overflowY: rootEl.style.overflowY
            });
            rootEl.style.setProperty('height', totalPageH + 'px', 'important');
            rootEl.style.setProperty('min-height', totalPageH + 'px', 'important');
            rootEl.style.setProperty('max-height', 'none', 'important');
            rootEl.style.setProperty('overflow', 'visible', 'important');
            rootEl.style.setProperty('overflow-y', 'visible', 'important');
            if (targetW > 0) {
              rootEl.style.setProperty('width', targetW + 'px', 'important');
              rootEl.style.setProperty('min-width', targetW + 'px', 'important');
            }
          }
        }
      }
    }).catch(()=>{});

    try {
      result = await chrome.tabs.sendMessage(source.id,{type:'WEBFIGMA_CAPTURE'});
    }
    finally {
      clearInterval(progressTimer);
      // 捕获后：瞬间恢复整条父链所有被解封的原始样式
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        func: () => {
          if (window.__webFigmaFixedRestores) {
            for (const r of window.__webFigmaFixedRestores) {
              try {
                r.el.style.height = r.height;
                r.el.style.maxHeight = r.maxHeight;
              } catch(e) {}
            }
            window.__webFigmaFixedRestores = [];
          }
          if (window.__webFigmaFloatingRestores) {
            for (const r of window.__webFigmaFloatingRestores) {
              try {
                if (r.position) r.el.style.position = r.position; else r.el.style.removeProperty('position');
                if (r.top) r.el.style.top = r.top; else r.el.style.removeProperty('top');
                if (r.bottom) r.el.style.bottom = r.bottom; else r.el.style.removeProperty('bottom');
                if (r.right) r.el.style.right = r.right; else r.el.style.removeProperty('right');
                if (r.zIndex) r.el.style.zIndex = r.zIndex; else r.el.style.removeProperty('z-index');
                if (r.height) r.el.style.height = r.height; else r.el.style.removeProperty('height');
                if (r.maxHeight) r.el.style.maxHeight = r.maxHeight; else r.el.style.removeProperty('max-height');
                if (r.parent) {
                  if (r.nextSibling && r.nextSibling.parentNode === r.parent) {
                    r.parent.insertBefore(r.el, r.nextSibling);
                  } else {
                    r.parent.appendChild(r.el);
                  }
                }
              } catch(e) {}
            }
            window.__webFigmaFloatingRestores = [];
          }
          if (window.__webFigmaPrecisionRestores) {
            for (const r of window.__webFigmaPrecisionRestores) {
              try {
                if (r.height) r.el.style.height = r.height; else r.el.style.removeProperty('height');
                if (r.maxHeight) r.el.style.maxHeight = r.maxHeight; else r.el.style.removeProperty('max-height');
                if (r.overflowY) r.el.style.overflowY = r.overflowY; else r.el.style.removeProperty('overflow-y');
                if (r.width) r.el.style.width = r.width; else r.el.style.removeProperty('width');
                if (r.minWidth) r.el.style.minWidth = r.minWidth; else r.el.style.removeProperty('min-width');
              } catch(e) {}
            }
            window.__webFigmaPrecisionRestores = [];
          }
        }
      }).catch(()=>{});
      await chrome.tabs.sendMessage(source.id,{type:'CAPTURE_UI',hidden:false}).catch(()=>{});
    }
    timings.captureMs=Date.now()-captureStarted;
    if (!result?.ok) throw Error(result?.error || '捕获失败');
        break;
      } catch(error) {
        clearInterval(progressTimer);
        await restoreViewport().catch(()=>{});
        // Reload can repair a disconnected or failed capture context, not configuration/permission errors.
        if(attempt===1 || /页面过长|捕获宽度未生效|权限|permission|denied|restricted|Cannot access|debugger/i.test(error.message))throw error;
        throw error;
      }
    }
    const verification=await chrome.scripting.executeScript({target:{tabId:source.id},func:async()=>{
      try {
        if (!navigator?.clipboard?.read) return {readable:false,error:'navigator.clipboard.read unavailable'};
        const items=await navigator.clipboard.read({unsanitized:['text/html']});
        for(const item of items)if(item.types.includes('text/html')) {
          const html=await (await item.getType('text/html')).text();
          return {readable:true,htmlLength:html.length,hasFigmaPayload:html.includes('(figh2d)')};
        }
        return {readable:true,htmlLength:0,hasFigmaPayload:false};
      }catch(error){return {readable:false,error:error.message};}
    }});
    await chrome.storage.local.set({lastCaptureDiagnostic:{at:Date.now(),generatedLength:result.html?.length || 0,clipboard:verification[0]?.result}});
    if(verification[0]?.result?.readable && !verification[0].result.hasFigmaPayload)
      throw Error('捕获已生成，但系统剪贴板中没有 Figma 图层数据，已停止跳转');
    stage='恢复网页尺寸';
    await restoreViewport().catch(()=>{});
    if(pasteMethod==='manual'){await status(source.id,'已复制网页图层，请在 Figma 画布按 Ctrl+V');return {ok:true,manual:true};}
    stage='切换并粘贴到 Figma';
    await status(source.id,'粘贴中…');
    if (mode === 'desktop') {
      let result;
      try {
        result = await chrome.runtime.sendNativeMessage('com.webfigma.helper',{action:'paste',title:config.clientTitle || ''});
      } catch (nativeErr) {
        result = { ok: false, error: nativeErr.message };
      }
      if (!result || !result.ok) {
        const err = result?.error || '客户端粘贴失败';
        if (/forbidden/i.test(err)) {
          throw Error(`扩展 ID [${chrome.runtime.id}] 未获本地助手授权，请运行助手目录下的『一键安装并注册.cmd』`);
        }
        throw Error(err);
      }
    } else {
      // Keep the confirmed capture/paste path independent of experimental placement.
      const placement=await pasteWeb(config.targetTabId);
      if(!placement.ok){await status(source.id,'粘贴成功；排列失败：'+placement.error);return {ok:true,arranged:false};}
    }
    await status(source.id,mode==='desktop'?'系统粘贴已发送，客户端结果待确认':'已确认 Figma 新增图层');
    return {ok:true,confirmed:false};
  } catch(e) {throw Error(`${stage}失败：${e.message}`);}
  finally {
    clearInterval(progressTimer);
    await chrome.tabs.sendMessage(source.id,{type:'TASK_FINISHED'}).catch(()=>{});
    timings.totalMs=Date.now()-started;
    await chrome.storage.local.set({lastTaskTiming:timings}).catch(()=>{});
    try {await restoreViewport().catch(()=>{});} finally {tasks.delete(source.id);tasks.delete(targetLock);}
  }
}
async function arrangeWeb(tabId, previous) {
  const tab=await chrome.tabs.get(tabId),url=new URL(tab.url);
  const key=await placementStorageKey(tab);
  const saved=(await chrome.storage.local.get(key))[key];
  // Only captures recorded by this sequence establish the placement anchor.
  // An unrelated selection before the first capture must never influence placement.
  const anchor=saved || null;
  const {frameGap=500}=await chrome.storage.local.get('frameGap');
  const invoke=async(action,args=null)=>{const [r]=await chrome.scripting.executeScript({target:{tabId},func:figmaPlacement,args:[action,args]});return r.result;};
  let current;
  for(let i=0;i<40;i++){
    current=await invoke('read');
    if(current.ok && current.nodeId && current.nodeId!==previous?.nodeId && current.nodeId!==saved?.nodeId)break;
    current=null;await new Promise(r=>setTimeout(r,300));
  }
  if(!current)return {ok:false,error:'未确认新画板的坐标，保留粘贴结果'};
  {
    const expected={X:anchor ? anchor.right+frameGap : 0,Y:0};
    for(const axis of ['X','Y']){
      let committed=false;
      for(let attempt=0;attempt<2 && !committed;attempt++){
        const selection=await invoke('read');
        if(!selection.ok || selection.nodeId!==current.nodeId)return {ok:false,error:'排列过程中选中画板变化，已停止修改'};
        const focus=await invoke('focusAxis',{axis});if(!focus.ok)return {ok:false,error:`无法聚焦 ${axis} 属性`};
        const result=await chrome.runtime.sendNativeMessage('com.webfigma.helper',{action:'coordinate',title:tab.title,value:String(Math.round(expected[axis]*1000000)/1000000)});
        if(!result.ok)return result;
        for(let poll=0;poll<10;poll++){
          await new Promise(r=>setTimeout(r,150));
          const read=await invoke('read');
          if(read.ok && read.nodeId!==current.nodeId)return {ok:false,error:'坐标提交时选中画板变化，已停止修改'};
          if(read.ok && Math.abs(read[axis==='X'?'x':'y']-expected[axis])<0.1){committed=true;break;}
        }
      }
      if(!committed)return {ok:false,error:`${axis} 坐标提交未确认，已保留粘贴结果`,nodeId:current.nodeId,expected};
    }
    const check=await invoke('read');
    if(!check.ok || check.nodeId!==current.nodeId || Math.abs(check.x-expected.X)>0.1 || Math.abs(check.y-expected.Y)>0.1)return {ok:false,error:'坐标回读未通过，未更新排列记录'};
    current=check;
  }
  await chrome.storage.local.set({[key]:{top:current.y,right:current.x+current.width,nodeId:current.nodeId,confirmedAt:Date.now()}});
  return {ok:true,moved:true,x:current.x,y:current.y};
}
async function preloadPage() {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function findContentScroller() {
    let best = null, maxDiff = 0;
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.matches('aside, nav, [role="navigation"], .tea-layout__side, [class*="side" i], [class*="menu" i]')) continue;
      if (el.closest('aside, nav, [role="navigation"], .tea-layout__side, [class*="side" i]')) continue;
      const diff = el.scrollHeight - el.clientHeight;
      if (diff > 80 && el.clientHeight > 180) {
        const s = window.getComputedStyle(el);
        if (['auto', 'scroll'].includes(s.overflowY)) {
          if (diff > maxDiff) { maxDiff = diff; best = el; }
        }
      }
    }
    const doc = document.scrollingElement || document.documentElement;
    const docDiff = doc.scrollHeight - window.innerHeight;
    if (docDiff > maxDiff && docDiff > 80) {
      return { el: doc, isWindow: true };
    }
    if (best) return { el: best, isWindow: false };
    return { el: doc, isWindow: true };
  }

  const { el: scroller, isWindow } = findContentScroller();
  const origPos = isWindow ? window.scrollY : scroller.scrollTop;
  const getScrollHeight = () => scroller.scrollHeight;
  const getClientHeight = () => isWindow ? window.innerHeight : scroller.clientHeight;
  const getScrollTop = () => isWindow ? window.scrollY : scroller.scrollTop;

  const scrollToPos = (pos) => {
    if (isWindow) {
      window.scrollTo({ top: pos, behavior: 'instant' });
    } else {
      scroller.scrollTop = pos;
    }
    const ev = new Event('scroll', { bubbles: true });
    scroller.dispatchEvent(ev);
    window.dispatchEvent(ev);
  };

  const started = Date.now();
  let steps = 0;
  let bottomStableCount = 0;

  try {
    // 从顶部平滑步进往下滚动右侧主内容
    scrollToPos(0);
    await wait(200);

    while (true) {
      if (++steps > 150 || Date.now() - started > 60000) break;

      const totalH = getScrollHeight();
      const viewH = getClientHeight();
      const currentPos = getScrollTop();

      const stepSize = Math.max(200, Math.floor(viewH * 0.65));
      const targetPos = Math.min(currentPos + stepSize, Math.max(0, totalH - viewH));

      scrollToPos(targetPos);
      await wait(220);

      const afterPos = getScrollTop();
      if (afterPos + viewH >= totalH - 15) {
        scrollToPos(totalH);
        await wait(400);
        const newTotalH = getScrollHeight();
        if (newTotalH <= totalH + 5) {
          bottomStableCount++;
          if (bottomStableCount >= 3) break;
        } else {
          bottomStableCount = 0;
        }
      } else {
        bottomStableCount = 0;
      }
    }

    // 同时顺便滚动左侧菜单栏（若存在内部滚动条），激活菜单可能存在的懒加载
    const sidebars = document.querySelectorAll('aside, nav, [role="navigation"], .tea-layout__side, [class*="side" i], [class*="menu" i]');
    for (const sb of sidebars) {
      if (sb.scrollHeight > sb.clientHeight + 40) {
        sb.scrollTop = sb.scrollHeight;
        sb.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      for (const c of sb.querySelectorAll('*')) {
        if (c.scrollHeight > c.clientHeight + 40) {
          c.scrollTop = c.scrollHeight;
          c.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      }
    }
    await wait(300);
    for (const sb of sidebars) {
      sb.scrollTop = 0;
      for (const c of sb.querySelectorAll('*')) c.scrollTop = 0;
    }

    // 等待卡片和图片完成挂载
    await wait(600);
    await Promise.race([
      Promise.allSettled(Array.from(document.images).filter(img => !img.complete).map(img => new Promise(res => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        if (img.complete) res();
      }))),
      wait(2500)
    ]);
  } finally {
    scrollToPos(origPos);
    await wait(200);
  }
  return { ok: true };
}
async function pasteWeb(tabId) {
  const tab=await chrome.tabs.update(tabId,{active:true});
  await chrome.windows.update(tab.windowId,{focused:true});
  const config=await chrome.storage.local.get(['placementEngine','frameGap']);
  const pluginEnabled=config.placementEngine!=='off';

  // ARM the plugin before paste — it will handle arrangement via documentchange event
  if(pluginEnabled){
    const armed=await callFigmaArranger(tabId,'ARM',{gap:config.frameGap ?? 500});
    if(!armed?.ok)throw Error(armed?.error || '排列器未能待命，请先在 Figma 中启动拾页排列器');
  }

  // Focus the Figma canvas
  const [focus]=await chrome.scripting.executeScript({target:{tabId},func:()=>{
    const input=document.getElementById('hidden-input') ||
      document.querySelector('textarea[aria-activedescendant="hidden-input-activedescendant"]') ||
      document.querySelector('textarea[aria-label*="Canvas" i]') ||
      document.querySelector('[contenteditable="true"][aria-activedescendant="hidden-input-activedescendant"]');
    if(input){input.focus({preventScroll:true});if(document.activeElement===input)return {ok:true,method:'input'};}
    const canvas=Array.from(document.querySelectorAll('canvas')).filter(el=>{
      const r=el.getBoundingClientRect();return r.width>200 && r.height>200;
    }).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    const surface=canvas || document.getElementById('hidden-input-activedescendant');
    if(!surface)return {ok:false,error:'未找到 Figma 画布，请确认文件已加载'};
    if(!surface.hasAttribute('tabindex'))surface.setAttribute('tabindex','-1');
    surface.focus({preventScroll:true});
    return {ok:document.activeElement===surface,method:'canvas'};
  }});
  await chrome.storage.local.set({lastPasteFocus:focus.result});
  if(!focus.result?.ok){
    if(pluginEnabled)await callFigmaArranger(tabId,'STOP').catch(()=>{});
    throw Error(focus.result?.error || 'Figma 画布未获得焦点，已取消粘贴');
  }

  // Send Ctrl+V via native-host
  let pasteResult;
  try {
    pasteResult=await chrome.runtime.sendNativeMessage('com.webfigma.helper',{action:'webpaste',title:tab.title||'Figma'});
  } catch(error) {
    throw Error('本地助手未连接，请先安装并检测连接。'+error.message);
  }
  if(!pasteResult?.ok) throw Error(pasteResult?.error || '本地助手执行失败');

  // Plugin handles arrangement asynchronously via documentchange — no COMMIT wait needed
  return {ok:true, arranged:'pending'};
}


async function captureCurrentState(source) {
  if (!source?.id) throw Error('无法识别来源网页');
  if (tasks.has(source.id)) throw Error('当前页面正在处理中');

  tasks.add(source.id);
  const config = await chrome.storage.local.get(['mode', 'clientTitle', 'targetTabId']);

  try {
    await status(source.id, '正在探测网页交互组件（下拉菜单、浮层）…');

    // 1. 注入 capture.js 和 interactive-probe.js
    const [probeLoaded] = await chrome.scripting.executeScript({
      target: { tabId: source.id },
      func: () => !!window.__webFigmaProbe
    });
    if (!probeLoaded.result) {
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        files: ['vendor/capture.js', 'interactive-probe.js']
      });
    }

    // 2. 扫描潜在目标
    const [targetsRes] = await chrome.scripting.executeScript({
      target: { tabId: source.id },
      func: () => {
        const targets = window.__webFigmaProbe.findTargets();
        return targets.length;
      }
    });

    const targetCount = targetsRes.result || 0;
    if (targetCount === 0) {
      await status(source.id, '当前页面未发现明显的下拉菜单或浮层');
      return { ok: true, count: 0 };
    }

    await status(source.id, `发现 ${targetCount} 个潜在交互入口，开始自动化逐项探测…`);

    let capturedCount = 0;
    for (let i = 0; i < targetCount; i++) {
      // 激活第 i 个组件
      const [act] = await chrome.scripting.executeScript({
        target: { tabId: source.id },
        func: async (idx) => {
          const targets = window.__webFigmaProbe.findTargets();
          const target = targets[idx];
          if (!target) return { ok: false };
          const res = await window.__webFigmaProbe.activateState(target);
          return { ok: true, ...res };
        },
        args: [i]
      });

      if (act.result?.hasNewState) {
        capturedCount++;
        const label = act.result.label || `交互状态 ${capturedCount}`;
        await status(source.id, `[${capturedCount}/${targetCount}] 探测到展开态 [${label}]，正在捕获并粘贴…`);

        // 隐藏常驻 UI 避免遮挡
        await chrome.tabs.sendMessage(source.id, { type: 'CAPTURE_UI', hidden: true }).catch(() => {});

        try {
          // 直接捕获当前展开了菜单的 DOM 状态
          const cap = await chrome.tabs.sendMessage(source.id, { type: 'WEBFIGMA_CAPTURE' });
          if (cap && cap.ok) {
            // 粘贴到 Figma 客户端或网页端
            if (config.mode === 'desktop') {
              await chrome.runtime.sendNativeMessage('com.webfigma.helper', {
                action: 'paste',
                title: config.clientTitle || ''
              });
            } else {
              await pasteWeb(config.targetTabId);
            }
            // 等待 1.5 秒给 Figma 插件自动排列
            await new Promise(r => setTimeout(r, 1500));
          }
        } finally {
          await chrome.tabs.sendMessage(source.id, { type: 'CAPTURE_UI', hidden: false }).catch(() => {});
        }
      }

      // 收起并恢复
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        func: async (idx) => {
          const targets = window.__webFigmaProbe.findTargets();
          if (targets[idx]) await window.__webFigmaProbe.deactivateState(targets[idx]);
        },
        args: [i]
      });

      await new Promise(r => setTimeout(r, 400));
    }

    const finishMsg = capturedCount > 0
      ? `✓ 交互探测完成：成功捕获并排列 ${capturedCount} 个展开状态`
      : '探测完成：未发现产生显著浮层的菜单组件';
    await status(source.id, finishMsg);
    return { ok: true, count: capturedCount };

  } catch (e) {
    await status(source.id, '交互探测出错：' + e.message);
    throw e;
  } finally {
    tasks.delete(source.id);
    await chrome.tabs.sendMessage(source.id, { type: 'TASK_FINISHED' }).catch(() => {});
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture_state') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      captureCurrentState(tab).catch(async e => {
        if (tab.id) await status(tab.id, e.message);
      });
    }
  }
});


async function captureCurrentState(source) {
  if (!source?.id) throw Error('无法识别来源网页');
  if (tasks.has(source.id)) throw Error('当前页面正在捕获中');

  tasks.add(source.id);
  const config = await chrome.storage.local.get(['mode', 'clientTitle', 'targetTabId']);

  try {
    await status(source.id, '正在捕获当前交互状态（零滚动）…');

    // 确保 capture.js 已在页面中加载
    const [loaded] = await chrome.scripting.executeScript({
      target: { tabId: source.id },
      func: () => !!globalThis.__webFigmaCaptureLoaded
    });
    if (!loaded.result) {
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        files: ['vendor/capture.js']
      });
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        func: () => { globalThis.__webFigmaCaptureLoaded = true; }
      });
    }

    // 临时隐藏常驻 UI 避免遮挡当前画面
    await chrome.tabs.sendMessage(source.id, { type: 'CAPTURE_UI', hidden: true }).catch(() => {});

    let result;
    try {
      // 在原位置零滚动、零缩放，直接抓取当前 DOM 状态
      result = await chrome.tabs.sendMessage(source.id, { type: 'WEBFIGMA_CAPTURE' });
    } finally {
      await chrome.tabs.sendMessage(source.id, { type: 'CAPTURE_UI', hidden: false }).catch(() => {});
    }

    if (!result?.ok) throw Error(result?.error || '捕获交互状态失败');

    // 切换到 Figma 粘贴
    await status(source.id, '正在粘贴到 Figma…');
    const mode = config.mode || 'desktop';
    if (mode === 'desktop') {
      let pasteRes;
      try {
        pasteRes = await chrome.runtime.sendNativeMessage('com.webfigma.helper', {
          action: 'paste',
          title: config.clientTitle || ''
        });
      } catch (nativeErr) {
        pasteRes = { ok: false, error: nativeErr.message };
      }
      if (!pasteRes || !pasteRes.ok) {
        const err = pasteRes?.error || '客户端粘贴失败';
        if (/forbidden/i.test(err)) {
          throw Error(`扩展 ID [${chrome.runtime.id}] 未获本地助手授权，请运行助手目录下的『一键安装并注册.cmd』`);
        }
        throw Error(err);
      }
    } else {
      await pasteWeb(config.targetTabId);
    }

    await status(source.id, '✓ 交互状态已送入 Figma 并自动排列！');
    return { ok: true, stateCapture: true };

  } catch (e) {
    await status(source.id, '交互状态捕获失败：' + e.message);
    throw e;
  } finally {
    tasks.delete(source.id);
    await chrome.tabs.sendMessage(source.id, { type: 'TASK_FINISHED' }).catch(() => {});
  }
}
