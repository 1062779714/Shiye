async function init(){
  const $=id=>document.getElementById(id);
  $('settingsToggle').onclick=()=>{const open=$('tools').hidden;$('tools').hidden=!open;$('settingsToggle').setAttribute('aria-expanded',String(open));};
  $('cancel').onclick=()=>window.close();

  document.getElementById('checkHelper').onclick=async()=>{
    $('checkHelper').disabled=true;
    let result;try{result=await chrome.runtime.sendMessage({type:'CHECK_HELPER'});}catch(error){result={ok:false,error:error.message};}finally{$('checkHelper').disabled=false;}
    $('connectionDot').className='dot '+(result?.ok?'ok':'fail');
    let errMsg = result?.error || '未知错误';
    if (/forbidden/i.test(errMsg)) {
      errMsg = `扩展 ID [${chrome.runtime.id}] 未被本地助手授权，请运行助手目录下的『一键安装并注册.cmd』`;
    }
    document.getElementById('helperStatus').textContent=result?.ok?'已连接本地助手 '+result.version:'未连接：'+errMsg;
  };

  document.getElementById('reloadExtension').onclick=()=>chrome.runtime.reload();
  const diagnostic=await chrome.storage.local.get(['lastCaptureDiagnostic','lastTaskTiming','lastPlacementResult','lastPasteFocus']);
  document.getElementById('diagnostics').textContent=JSON.stringify(diagnostic,null,2);

  const config=await chrome.storage.local.get(['mode','targetTabId','clientTitle','frameGap','captureWidth','pasteMethod','placementEngine','showFloatingIcon']);
  $('placementEngine').value=config.placementEngine || 'native';
  $('pasteMethod').value=config.pasteMethod || 'native';
  $('floatingIconToggle').checked = config.showFloatingIcon !== false;

  $('floatingIconToggle').onchange = async () => {
    const val = $('floatingIconToggle').checked;
    await chrome.storage.local.set({ showFloatingIcon: val });
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, { type: 'TOGGLE_FLOATING_ICON', show: val }).catch(() => {});
    }
  };

  const gap=document.getElementById('gap');
  gap.value=config.frameGap ?? 500;

  // 窗口尺寸 / 捕获宽度交互
  let currentSelectedWidth = Number(config.captureWidth) || 0;
  let currentSelectedHeight = Number(config.captureHeight) || 0;

  async function resizeCurrentWindow(width, height) {
    try {
      const win = await chrome.windows.getCurrent();
      if (width > 0 && height > 0) {
        const updateInfo = { width: Number(width), height: Number(height) };
        if (win.state === 'maximized') updateInfo.state = 'normal';
        await chrome.windows.update(win.id, updateInfo);
      }
      return true;
    } catch (e) {
      console.warn('调整窗口大小失败:', e);
      return false;
    }
  }

  const presetBtns = Array.from(document.querySelectorAll('.preset-btn'));
  function highlightSize(w) {
    presetBtns.forEach(btn => {
      const bw = Number(btn.dataset.w);
      if (bw === w || (w === 0 && bw === 0)) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  highlightSize(currentSelectedWidth);
  if (currentSelectedWidth > 0) $('customW').value = currentSelectedWidth;
  if (currentSelectedHeight > 0) $('customH').value = currentSelectedHeight;

  presetBtns.forEach(btn => {
    btn.onclick = async () => {
      const w = Number(btn.dataset.w);
      const h = Number(btn.dataset.h);
      currentSelectedWidth = w;
      currentSelectedHeight = h;
      highlightSize(w);

      if (w > 0 && h > 0) {
        await resizeCurrentWindow(w, h);
        $('customW').value = w;
        $('customH').value = h;
        $('status').textContent = `已调整窗口尺寸为 ${w} × ${h}`;
      } else {
        const win = await chrome.windows.getCurrent();
        $('status').textContent = `保持当前尺寸 (约 ${win.width} × ${win.height})`;
      }
      await chrome.storage.local.set({ captureWidth: w, captureHeight: h });
    };
  });

  // 获取当前尺寸
  $('btnGetCurrentSize').onclick = async () => {
    const win = await chrome.windows.getCurrent();
    $('customW').value = win.width;
    $('customH').value = win.height;
    $('currentSizeHint').textContent = `当前窗口：${win.width} × ${win.height}`;
    $('customSizeDetails').open = true;
  };

  // 应用自定义尺寸
  $('applyCustomSize').onclick = async () => {
    const w = parseInt($('customW').value, 10);
    const h = parseInt($('customH').value, 10);
    if (!w || w < 320 || !h || h < 200) {
      $('status').textContent = '请输入有效的宽度和高度 (宽≥320, 高≥200)';
      return;
    }
    currentSelectedWidth = w;
    currentSelectedHeight = h;
    highlightSize(w);
    await resizeCurrentWindow(w, h);
    await chrome.storage.local.set({ captureWidth: w, captureHeight: h });
    $('status').textContent = `已调整窗口尺寸为 ${w} × ${h}`;
  };

  const mode=document.getElementById('mode'),tabs=document.getElementById('tabs');
  mode.value=config.mode || 'desktop';
  async function refreshTabs(){
    const selected=Number(tabs.value) || config.targetTabId;
    tabs.replaceChildren();
    const found=(await chrome.tabs.query({})).filter(t=>/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(t.url || ''));
    for(const tab of found){const o=document.createElement('option');o.value=tab.id;o.textContent=tab.title;tabs.append(o);}
    if(!found.length){const o=document.createElement('option');o.value='';o.textContent='请先打开 Figma 设计文件';tabs.append(o);}
    if(found.some(t=>t.id===selected))tabs.value=String(selected);
  }
  $('resetPlacement').onclick=async()=>{
    await chrome.storage.local.remove(['desktopPlacementNextX', 'desktopPlacementLastOrigin']);
    if(mode.value==='web' && tabs.value){
      await chrome.runtime.sendMessage({type:'RESET_PLACEMENT',tabId:Number(tabs.value)});
    }
    $('status').textContent='已重置！下次新画板从原点 (0, 0) 开始';
  };
  await refreshTabs();$('refreshTabs').onclick=refreshTabs;
  $('checkArranger').onclick=async()=>{
    if(mode.value==='web'){
      if(!tabs.value){$('arrangerStatus').textContent='请先选择目标文件';return;}
      $('checkArranger').disabled=true;
      try{const r=await chrome.runtime.sendMessage({type:'CHECK_ARRANGER',tabId:Number(tabs.value)});$('arrangerStatus').textContent=r?.ok?'已连接 · '+r.pageName:r?.error || '未连接';}
      catch(e){$('arrangerStatus').textContent=e.message;}finally{$('checkArranger').disabled=false;}
    } else {
      $('arrangerStatus').textContent='本地助手自动排列模式就绪（无需插件）';
    }
  };
  const update=()=>{
    $('webTarget').hidden=mode.value!=='web';
    $('webMode').setAttribute('aria-pressed',String(mode.value==='web'));
    $('desktopMode').setAttribute('aria-pressed',String(mode.value==='desktop'));
    $('arrangerStatus').textContent=mode.value==='desktop'?'本地助手自动排列模式就绪':'在目标网页端启动拾页排列器';
    $('checkHelper').disabled=$('pasteMethod').value==='manual';
    $('helperStatus').textContent=$('pasteMethod').value==='manual'?'捕获完成后，请在 Figma 中手动粘贴':'本地助手尚未检测';
  };
  $('webMode').onclick=()=>{mode.value='web';update();};$('desktopMode').onclick=()=>{mode.value='desktop';update();};
  $('pasteMethod').onchange=update;update();
  document.getElementById('save').onclick=async()=>{
    if(!gap.checkValidity() || gap.value.trim()===''){document.getElementById('status').textContent='间隔请输入 0–10000 的整数';return;}
    if($('pasteMethod').value!=='manual'&&mode.value==='web'&&!tabs.value){document.getElementById('status').textContent='请先打开 Figma 文件';return;}
    await chrome.storage.local.set({
      mode:mode.value,
      targetTabId:tabs.value ? Number(tabs.value) : null,
      pasteMethod:$('pasteMethod').value,
      placementEngine:$('placementEngine').value,
      frameGap:Number(gap.value),
      captureWidth:Number(currentSelectedWidth),
      captureHeight:Number(currentSelectedHeight),
      showFloatingIcon:$('floatingIconToggle').checked
    });
    document.getElementById('status').textContent='已保存';
  };
}init();
