// A request-scoped bridge to the running local Figma plugin UI. No local network server.
async function callFigmaArranger(tabId,command,payload={}) {
  const tab=await chrome.tabs.get(tabId);
  if(!/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(tab.url || ''))throw Error('排列器只连接已打开的 Figma 设计文件');
  const [response]=await chrome.scripting.executeScript({target:{tabId},func:async(command,payload)=>{
    const requestId=crypto.randomUUID();
    const message={...payload,channel:'PAGEPICK_BRIDGE_V1',requestId,command};
    return await new Promise(resolve=>{
      let timer;
      const finish=result=>{clearTimeout(timer);window.removeEventListener('message',receive);resolve(result);};
      const receive=event=>{const m=event.data;if(m?.channel==='PAGEPICK_BRIDGE_REPLY_V1' && m.requestId===requestId)finish(m.result);};
      window.addEventListener('message',receive);
      timer=setTimeout(()=>finish({ok:false,error:'当前选择 Figma 网页端，但未连接网页内插件。若插件开在客户端，请将导入目标改为 Figma 客户端并保存'}),5000);
      let count=0;
      function broadcast(w,depth){
        if(depth>8 || count++>300)return;
        try{w.postMessage(message,'*');}catch{}
        try{for(let i=0;i<w.frames.length;i++)broadcast(w.frames[i],depth+1);}catch{}
      }
      broadcast(window,0);
    });
  },args:[command,payload]});
  return response.result;
}
