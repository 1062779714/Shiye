importScripts('placement.js','plugin-bridge.js');
const tasks = new Set();
async function injectButtons() {
  const tabs=await chrome.tabs.query({url:['http://*/*','https://*/*']});
  await Promise.allSettled(tabs.map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']})));
}
chrome.runtime.onInstalled.addListener(()=>injectButtons());
chrome.runtime.onStartup.addListener(()=>injectButtons());
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
  if (config.pasteMethod!=='manual' && config.mode !== 'desktop') {
    if (!Number.isInteger(config.targetTabId) || config.targetTabId < 0) {
      throw Error('请先点击浏览器工具栏中的扩展图标，绑定目标 Figma 文件');
    }
    const target = await chrome.tabs.get(config.targetTabId).catch(()=>null);
    if (!target || !/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(target.url || '')) throw Error('请先在扩展设置中绑定 Figma 文件标签页');
    if(config.placementEngine!=='off'){const connected=await callFigmaArranger(config.targetTabId,'PING');if(!connected?.ok)throw Error(connected?.error || '请先启动拾页排列器');}
    if (target.id === source.id) throw Error('请在需要捕获的网页上操作');
  }
  const targetLock=config.pasteMethod==='manual'?`manual:${source.id}`:`target:${config.mode==='desktop'?'desktop':config.targetTabId}`;
  if(tasks.has(targetLock))throw Error('目标 Figma 正在处理上一张画板，请完成后再试');
  tasks.add(targetLock);
  tasks.add(source.id);
  let stage='准备捕获',progressTimer;
  const timings={},started=Date.now();
  let viewportAttached=false;
  const restoreViewport=async()=>{
    if(!viewportAttached)return;
    try {await chrome.debugger.sendCommand({tabId:source.id},'Emulation.clearDeviceMetricsOverride');}
    finally {await chrome.debugger.detach({tabId:source.id}).catch(()=>{});viewportAttached=false;}
  };
  try {
    let result;
    for(let attempt=0;attempt<2;attempt++) {
      try {
    stage='准备捕获';
    await status(source.id,'准备加载完整内容…');
    await chrome.tabs.update(source.id,{active:true});
    if ([1366,1440,1920].includes(config.captureWidth)) {
      await status(source.id,`调整捕获宽度为 ${config.captureWidth} px…`);
      const [size]=await chrome.scripting.executeScript({target:{tabId:source.id},func:()=>({height:innerHeight})});
      await chrome.debugger.attach({tabId:source.id},'1.3');viewportAttached=true;
      await chrome.debugger.sendCommand({tabId:source.id},'Emulation.setDeviceMetricsOverride',{
        width:config.captureWidth,height:Math.max(600,size.result.height),deviceScaleFactor:0,mobile:false
      });
      await new Promise(resolve=>setTimeout(resolve,600));
      const [actual]=await chrome.scripting.executeScript({target:{tabId:source.id},func:()=>innerWidth});
      if(actual.result!==config.captureWidth)throw Error(`捕获宽度未生效：实际 ${actual.result} px`);
    }
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

    // 捕获前：深度解封真正包含 3000px+ 内容的主容器（如 overview-v2）及其所有父链
    await chrome.scripting.executeScript({
      target: { tabId: source.id },
      func: () => {
        // 找到最大内容滚动容器
        let best = null, maxDiff = 0;
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const diff = el.scrollHeight - el.clientHeight;
          if (diff > 120 && el.clientHeight > 180) {
            const s = window.getComputedStyle(el);
            if (['auto', 'scroll'].includes(s.overflowY)) {
              if (diff > maxDiff) { maxDiff = diff; best = el; }
            }
          }
        }

        window.__webFigmaDeepRestores = [];

        // 锁定右侧小悬浮挂件（如客服药丸条），防止在页面撑开时被拉伸变形
        window.__webFigmaFixedRestores = [];
        const allFixed = document.querySelectorAll('*');
        for (const el of allFixed) {
          if (el.id === 'webfigma-helper' || el.closest('#webfigma-helper')) continue;
          const s = window.getComputedStyle(el);
          if (s.position === 'fixed') {
            const h = el.offsetHeight;
            const w = el.offsetWidth;
            // 如果是局部小挂件（非全屏遮罩），把宽高锁死在当前像素值上
            if (h > 0 && h < 600 && w > 0 && w < 400) {
              window.__webFigmaFixedRestores.push({
                el,
                height: el.style.height,
                maxHeight: el.style.maxHeight
              });
              el.style.setProperty('height', h + 'px', 'important');
              el.style.setProperty('max-height', h + 'px', 'important');
            }
          }
        }

        function uncapElement(el) {
          if (!el || el === document) return;
          const s = window.getComputedStyle(el);
          // 绝对不能解封 position: fixed 挂件
          if (s.position === 'fixed') return;

          window.__webFigmaDeepRestores.push({
            el,
            height: el.style.height,
            maxHeight: el.style.maxHeight,
            overflow: el.style.overflow,
            overflowY: el.style.overflowY
          });
          el.style.setProperty('height', 'auto', 'important');
          el.style.setProperty('max-height', 'none', 'important');
          el.style.setProperty('overflow', 'visible', 'important');
          el.style.setProperty('overflow-y', 'visible', 'important');
        }

        if (best) {
          uncapElement(best);
          let curr = best.parentElement;
          while (curr && curr !== document) {
            uncapElement(curr);
            curr = curr.parentElement;
          }
        }

        uncapElement(document.documentElement);
        uncapElement(document.body);
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
          if (window.__webFigmaDeepRestores) {
            for (const r of window.__webFigmaDeepRestores) {
              try {
                r.el.style.height = r.height;
                r.el.style.maxHeight = r.maxHeight;
                r.el.style.overflow = r.overflow;
                r.el.style.overflowY = r.overflowY;
              } catch(e) {}
            }
            window.__webFigmaDeepRestores = [];
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
        await status(source.id,'捕获异常，刷新网页后自动重试一次…');
        stage='刷新并恢复捕获';
        await reloadSource(source.id);
      }
    }
    const verification=await chrome.scripting.executeScript({target:{tabId:source.id},func:async()=>{
      try {
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
    if(config.pasteMethod==='manual'){await status(source.id,'已复制网页图层，请在 Figma 画布按 Ctrl+V');return {ok:true,manual:true};}
    stage='切换并粘贴到 Figma';
    await status(source.id,'粘贴中…');
    if (config.mode === 'desktop') {
      const result = await chrome.runtime.sendNativeMessage('com.webfigma.helper',{action:'paste',title:config.clientTitle || ''});
      if (!result.ok) throw Error(result.error || '客户端粘贴失败');
    } else {
      // Keep the confirmed capture/paste path independent of experimental placement.
      const placement=await pasteWeb(config.targetTabId);
      if(!placement.ok){await status(source.id,'粘贴成功；排列失败：'+placement.error);return {ok:true,arranged:false};}
    }
    await status(source.id,config.mode==='desktop'?'系统粘贴已发送，客户端结果待确认':'已确认 Figma 新增图层');
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

  // 动态锁定全页面滚动差值最大的真实容器（如腾讯云 overview-v2 高达 3616px）
  function findTrueScroller() {
    let best = null, maxDiff = 0;
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff > 120 && el.clientHeight > 180) {
        const s = window.getComputedStyle(el);
        if (['auto', 'scroll'].includes(s.overflowY)) {
          if (diff > maxDiff) {
            maxDiff = diff;
            best = el;
          }
        }
      }
    }
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight - window.innerHeight > maxDiff) {
      return { el: doc, isWindow: true, maxDiff: doc.scrollHeight - window.innerHeight };
    }
    if (best) return { el: best, isWindow: false, maxDiff };
    return { el: doc, isWindow: true, maxDiff: 0 };
  }

  const scrollerInfo = findTrueScroller();
  const targetEl = scrollerInfo.el;
  const isWindow = scrollerInfo.isWindow;

  const originalPos = isWindow ? window.scrollY : targetEl.scrollTop;
  const scrollHeight = () => targetEl.scrollHeight;
  const clientHeight = () => isWindow ? window.innerHeight : targetEl.clientHeight;

  const doScrollTo = (pos) => {
    if (isWindow) {
      window.scrollTo({ top: pos, behavior: 'instant' });
    } else {
      targetEl.scrollTop = pos;
    }
  };

  const started = Date.now();
  let limited = false, steps = 0;

  try {
    doScrollTo(0);
    await wait(350);

    let bottomStable = 0;
    while (true) {
      if (++steps > 240 || Date.now() - started > 120000) { limited = true; break; }
      const totalH = scrollHeight();
      const viewH = clientHeight();
      const currentPos = isWindow ? window.scrollY : targetEl.scrollTop;
      const next = Math.min(currentPos + Math.max(250, Math.floor(viewH * 0.75)), Math.max(0, totalH - viewH));
      doScrollTo(next);
      await wait(300);

      const afterPos = isWindow ? window.scrollY : targetEl.scrollTop;
      if (afterPos + viewH >= totalH - 10) {
        await wait(500);
        const afterTotalH = scrollHeight();
        bottomStable = (afterTotalH === totalH) ? bottomStable + 1 : 0;
        if (bottomStable >= 3) break;
      } else {
        bottomStable = 0;
      }
    }

    // 等待图片和字体加载完毕
    await Promise.race([
      Promise.allSettled(Array.from(document.images).filter(img => !img.complete).map(img => new Promise(res => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        if (img.complete) res();
      }))),
      wait(5000)
    ]);
    if (document.fonts) await Promise.race([document.fonts.ready, wait(2500)]);

  } finally {
    doScrollTo(originalPos);
    await wait(300);
  }
  return { limited, steps, isWindow };
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
    if (config.mode === 'desktop') {
      const pasteRes = await chrome.runtime.sendNativeMessage('com.webfigma.helper', {
        action: 'paste',
        title: config.clientTitle || ''
      });
      if (!pasteRes.ok) throw Error(pasteRes.error || '客户端粘贴失败');
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
