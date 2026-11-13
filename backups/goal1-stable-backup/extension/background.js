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
    try {result = await chrome.tabs.sendMessage(source.id,{type:'WEBFIGMA_CAPTURE'});}
    finally {
      clearInterval(progressTimer);
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
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const original={x:scrollX,y:scrollY};
  const scrolling=document.scrollingElement || document.documentElement;
  const previousBehavior=scrolling.style.scrollBehavior;
  scrolling.style.scrollBehavior='auto';
  const started=Date.now();
  let limited=false,steps=0;
  const height=()=>Math.max(scrolling.scrollHeight,document.body?.scrollHeight || 0);
  try {
    window.scrollTo({top:0,left:original.x,behavior:'instant'});
    await wait(500);
    let bottomStable=0;
    while (true) {
      if (++steps>240 || Date.now()-started>120000) {limited=true;break;}
      const before=height();
      const next=Math.min(scrollY+Math.max(200,Math.floor(innerHeight*0.75)),Math.max(0,before-innerHeight));
      window.scrollTo({top:next,left:original.x,behavior:'instant'});
      await wait(450);
      if (scrollY+innerHeight>=height()-3) {
        await wait(850);
        const after=height();
        bottomStable=after===before ? bottomStable+1 : 0;
        if (bottomStable>=3) break;
      } else bottomStable=0;
    }
    // Wait for currently requested images and fonts without blocking indefinitely.
    await Promise.race([
      Promise.allSettled(Array.from(document.images).filter(image=>!image.complete).map(image=>new Promise(resolve=>{
        image.addEventListener('load',resolve,{once:true});
        image.addEventListener('error',resolve,{once:true});
        if(image.complete) resolve();
      }))),
      wait(8000)
    ]);
    if(document.fonts) await Promise.race([document.fonts.ready,wait(3000)]);
  } finally {
    window.scrollTo({top:original.y,left:original.x,behavior:'instant'});
    await wait(500);
    scrolling.style.scrollBehavior=previousBehavior;
  }
  return {limited,steps};
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
