(() => {
  if (window !== top) return;
  // Replacing the old host reconnects its listeners after an extension reload.
  document.getElementById('webfigma-helper')?.remove();
  const host=document.createElement('div'); host.id='webfigma-helper';
  host.setAttribute('data-h2d-ignore','true');
  host.style.cssText='width:48px;height:48px;position:fixed;right:24px;bottom:32px;z-index:2147483647';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML="<style>button{box-sizing:border-box;display:grid;place-items:center;border:1px solid #ffffff70;border-radius:15px;width:48px;height:48px;background:#202224;color:white;box-shadow:0 4px 14px #36307830,inset 0 1px 0 #ffffff38;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease;padding:0;overflow:hidden}button svg{width:100%;height:100%;display:block}button:hover{transform:translateY(-2px);box-shadow:0 6px 20px #36307840,inset 0 1px 0 #ffffff38}button:active{transform:scale(.95)}button:focus-visible{outline:3px solid #b8b1ff;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}p{position:absolute;right:0;bottom:52px;background:#25283a;color:#fff;border:1px solid #ffffff18;border-radius:9px;padding:9px 12px;max-width:320px;width:max-content;white-space:normal;box-shadow:0 4px 16px #0002;font:12px/1.5 system-ui}p:empty{display:none}@media(prefers-reduced-motion:reduce){button{transition:none}}</style><p role=\"status\" aria-live=\"polite\"></p><button title=\"拾页 · 捕获网页并导入 Figma\" aria-label=\"拾页 · 捕获网页并导入 Figma\"><svg width=\"512\" height=\"512\" viewBox=\"0 0 512 512\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0_22_5262)\">\n<path d=\"M404 0H108C48.3532 0 0 48.3532 0 108V404C0 463.647 48.3532 512 108 512H404C463.647 512 512 463.647 512 404V108C512 48.3532 463.647 0 404 0Z\" fill=\"url(#paint0_linear_22_5262)\"/>\n<path d=\"M102 202V151.398C102 123.687 123.687 102 151.398 102H202\" stroke-width=\"28\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke=\"white\"/>\n<path d=\"M310 102H360.602C388.313 102 410 123.687 410 151.398V202\" stroke-width=\"28\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke=\"white\"/>\n<path d=\"M102 310V360.602C102 388.313 123.687 410 151.398 410H202\" stroke-width=\"28\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke=\"white\"/>\n<path d=\"M396.812 310H326.188C314.486 310 305 319.486 305 331.188V401.812C305 413.514 314.486 423 326.188 423H396.812C408.514 423 418 413.514 418 401.812V331.188C418 319.486 408.514 310 396.812 310Z\" fill=\"url(#paint1_linear_22_5262)\"/>\n</g>\n<defs>\n<linearGradient id=\"paint0_linear_22_5262\" x1=\"35\" y1=\"20\" x2=\"480\" y2=\"512\" gradientUnits=\"userSpaceOnUse\">\n<stop stop-color=\"#292B2D\"/>\n<stop offset=\"1\" stop-color=\"#191B1C\"/>\n</linearGradient>\n<linearGradient id=\"paint1_linear_22_5262\" x1=\"305\" y1=\"310\" x2=\"426.828\" y2=\"431.828\" gradientUnits=\"userSpaceOnUse\">\n<stop stop-color=\"#347BFF\"/>\n<stop offset=\"1\" stop-color=\"#2460EB\"/>\n</linearGradient>\n<clipPath id=\"clip0_22_5262\">\n<rect width=\"512\" height=\"512\" fill=\"white\"/>\n</clipPath>\n</defs>\n</svg>\n</button>";
  document.documentElement.append(host);
  const button=root.querySelector('button'), label=root.querySelector('p');
  let visibilityTimer;
  const show=()=>{clearTimeout(visibilityTimer);host.style.visibility='visible';};
  chrome.runtime.onMessage.addListener(m=>{
    if(m.type==='STATUS')label.textContent=m.text;
    if(m.type==='CAPTURE_UI'){
      if(m.hidden){host.style.visibility='hidden';clearTimeout(visibilityTimer);visibilityTimer=setTimeout(show,95000);}
      else show();
    }
    if(m.type==='TASK_FINISHED'){show();button.disabled=false;}
  });
  button.onclick=async()=>{
    button.disabled=true;label.textContent='准备捕获…';
    try {
      const result=await chrome.runtime.sendMessage({type:'RUN_CAPTURE'});
      if(!result?.ok) label.textContent=result?.error || '操作失败';
    } catch(e){label.textContent=e.message;}
    finally{host.style.visibility='visible';button.disabled=false;}
  };
})();
