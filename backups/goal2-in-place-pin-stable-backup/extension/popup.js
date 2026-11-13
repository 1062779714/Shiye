async function init(){
  const $=id=>document.getElementById(id);
  $('settingsToggle').onclick=()=>{const open=$('tools').hidden;$('tools').hidden=!open;$('settingsToggle').setAttribute('aria-expanded',String(open));};
  $('cancel').onclick=()=>window.close();

  document.getElementById('checkHelper').onclick=async()=>{
    $('placementEngine').disabled=mode.value==='desktop';$('arrangerStatus').textContent=mode.value==='desktop'?'在客户端插件开启接收；间隔请在插件内设置':'在目标文件启动拾页排列器';$('checkArranger').disabled=mode.value==='desktop';
    $('checkHelper').disabled=true;
    let result;try{result=await chrome.runtime.sendMessage({type:'CHECK_HELPER'});}catch(error){result={ok:false,error:error.message};}finally{$('checkHelper').disabled=false;}
    $('connectionDot').className='dot '+(result?.ok?'ok':'fail');
    document.getElementById('helperStatus').textContent=result?.ok?'已连接本地助手 '+result.version:'未连接：'+(result?.error || '未知错误');
  };

  document.getElementById('reloadExtension').onclick=()=>chrome.runtime.reload();
  const diagnostic=await chrome.storage.local.get(['lastCaptureDiagnostic','lastTaskTiming','lastPlacementResult','lastPasteFocus']);
  document.getElementById('diagnostics').textContent=JSON.stringify(diagnostic,null,2);

  const config=await chrome.storage.local.get(['mode','targetTabId','clientTitle','frameGap','captureWidth','browserEnvironment','pasteMethod','placementEngine']);
  $('placementEngine').value=config.placementEngine || 'plugin';
  $('browser').value=config.browserEnvironment || 'aside';
  $('pasteMethod').value=config.pasteMethod || 'native';
  const gap=document.getElementById('gap'),width=document.getElementById('width');
  gap.value=config.frameGap ?? 500; width.value=String(config.captureWidth || 0);
  const mode=document.getElementById('mode'),tabs=document.getElementById('tabs'),title=document.getElementById('title');
  mode.value=config.mode || 'web'; title.value=config.clientTitle || '';
  async function refreshTabs(){
    const selected=Number(tabs.value) || config.targetTabId;
    tabs.replaceChildren();
    const found=(await chrome.tabs.query({})).filter(t=>/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(t.url || ''));
    for(const tab of found){const o=document.createElement('option');o.value=tab.id;o.textContent=tab.title;tabs.append(o);}
    if(!found.length){const o=document.createElement('option');o.value='';o.textContent='请先打开 Figma 设计文件';tabs.append(o);}
    if(found.some(t=>t.id===selected))tabs.value=String(selected);
  }
  $('resetPlacement').onclick=async()=>{
    if(mode.value!=='web' || !tabs.value){$('status').textContent='请先选择 Figma 网页设计文件';return;}
    const result=await chrome.runtime.sendMessage({type:'RESET_PLACEMENT',tabId:Number(tabs.value)});
    $('status').textContent=result.ok?'已重置，下次新画板从 (0, 0) 开始；已有画板不移动':result.error;
  };
  await refreshTabs();$('refreshTabs').onclick=refreshTabs;
  $('checkArranger').onclick=async()=>{
    if(!tabs.value){$('arrangerStatus').textContent='请先选择目标文件';return;}
    $('checkArranger').disabled=true;
    try{const r=await chrome.runtime.sendMessage({type:'CHECK_ARRANGER',tabId:Number(tabs.value)});$('arrangerStatus').textContent=r?.ok?'已连接 · '+r.pageName:r?.error || '未连接';}
    catch(e){$('arrangerStatus').textContent=e.message;}finally{$('checkArranger').disabled=false;}
  };
  const update=()=>{
    $('webTarget').hidden=mode.value!=='web';$('desktopTarget').hidden=mode.value!=='desktop';
    $('webMode').setAttribute('aria-pressed',String(mode.value==='web'));
    $('desktopMode').setAttribute('aria-pressed',String(mode.value==='desktop'));
    $('placementEngine').disabled=mode.value==='desktop';$('arrangerStatus').textContent=mode.value==='desktop'?'在客户端插件开启接收；间隔请在插件内设置':'在目标文件启动拾页排列器';$('checkArranger').disabled=mode.value==='desktop';
    $('checkHelper').disabled=$('pasteMethod').value==='manual';
    $('helperStatus').textContent=$('pasteMethod').value==='manual'?'捕获完成后，请在 Figma 中手动粘贴':'本地助手尚未检测';
  };
  $('webMode').onclick=()=>{mode.value='web';update();};$('desktopMode').onclick=()=>{mode.value='desktop';update();};
  $('pasteMethod').onchange=update;update();
  document.getElementById('save').onclick=async()=>{
    if(!gap.checkValidity() || gap.value.trim()===''){document.getElementById('status').textContent='间隔请输入 0–10000 的整数';return;}
    if($('pasteMethod').value!=='manual'&&mode.value==='web'&&!tabs.value){document.getElementById('status').textContent='请先打开 Figma 文件';return;}
    await chrome.storage.local.set({mode:mode.value,targetTabId:tabs.value ? Number(tabs.value) : null,clientTitle:title.value.trim(),browserEnvironment:$('browser').value,pasteMethod:$('pasteMethod').value,placementEngine:$('placementEngine').value,frameGap:Number(gap.value),captureWidth:Number(width.value)});
    document.getElementById('status').textContent='已保存';
  };
}init();
