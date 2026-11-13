// Runs in the Figma tab. Only use explicitly labelled property fields.
async function figmaPlacement(action, position) {
  if(action==='layers' || action==='newLayer') {
    const grids=Array.from(document.querySelectorAll('[role="treegrid"]'));
    const rows=grids.flatMap(grid=>Array.from(grid.querySelectorAll('[role="row"]'))).map(row=>{
      const r=row.getBoundingClientRect();
      const name=(row.getAttribute('aria-label') || row.textContent || '').trim();
      return {name,x:r.x+Math.min(100,r.width/2),y:r.y+r.height/2,visible:r.width>0 && r.height>0 && r.y>=0 && r.bottom<=innerHeight};
    });
    if(action==='layers')return {ok:true,names:rows.map(row=>row.name)};
    const counts=new Map();
    for(const name of position.names)counts.set(name,(counts.get(name)||0)+1);
    const added=rows.filter(row=>{const count=counts.get(row.name)||0;if(count){counts.set(row.name,count-1);return false;}return true;});
    if(added.length!==1 || !added[0].visible)return {ok:false};
    return {ok:true,...added[0]};
  }
  function field(name) {
    const candidates=Array.from(document.querySelectorAll('input,[role="spinbutton"],[role="combobox"]')).filter(input=>{
      const rect=input.getBoundingClientRect();
      if(rect.width<10 || rect.height<10 || input.disabled || input.readOnly || input.getAttribute('aria-disabled')==='true')return false;
      const labels=[input.getAttribute('aria-label'),input.getAttribute('data-tooltip'),input.getAttribute('placeholder')];
      let parent=input.parentElement;
      for(let depth=0;parent && depth<3;depth++,parent=parent.parentElement) {
        if(parent.querySelectorAll('input').length!==1)break;
        labels.push(parent.textContent);
        for(const el of parent.querySelectorAll('[aria-label],[data-tooltip],[title]'))
          labels.push(el.getAttribute('aria-label'),el.getAttribute('data-tooltip'),el.getAttribute('title'));
      }
      if(input.id) labels.push(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent);
      const aliases={X:['X','X-position','X position','Position X','Horizontal position','横坐标'],Y:['Y','Y-position','Y position','Position Y','Vertical position','纵坐标'],W:['W','Width','宽度']}[name];
      return labels.some(label=>label && aliases.some(alias=>label.trim().toLowerCase()===alias.toLowerCase()));
    });
    const unique=candidates.filter(el=>!candidates.some(other=>other!==el && el.contains(other)));
    return unique.length===1 ? unique[0] : null;
  }
  const x=field('X'),y=field('Y'),w=field('W');
  if(!x || !y || !w) return {ok:false,error:'无法识别 Figma 的 X、Y、宽度属性，尚未自动排列'};
  if(action==='focusAxis'){const input=position.axis==='X'?x:y;input.focus({preventScroll:true});if(typeof input.select==='function')input.select();return {ok:document.activeElement===input};}
  if(action==='locate') {
    const rect=(position.axis==='X'?x:y).getBoundingClientRect();
    return {ok:true,x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  }
  if(action==='read') {
    const value=el=>String(el.value ?? el.getAttribute('aria-valuenow') ?? el.querySelector('input')?.value ?? '').trim();
    const raw=[value(x),value(y),value(w)];
    const values={x:Number(raw[0]),y:Number(raw[1]),width:Number(raw[2])};
    if(!raw.every(v=>v!=='' && Number.isFinite(Number(v))) || values.width<=0)return {ok:false,error:'所选内容的坐标或宽度不可读取'};
    const main=document.getElementById('hidden-input-activedescendant');
    const selected=main && Array.from(main.querySelectorAll('[id]')).find(el=>/^\d+:\d+$/.test(el.id) && el.id!=='0:1');
    const urlId=new URL(location.href).searchParams.get('node-id');
    const selectedId=urlId && urlId!=='0-1' ? urlId : selected?.id;
    return {ok:true,...values,nodeId:selectedId?.replaceAll(':','-') || null};
  }
  function set(input,value) {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));
    input.blur();
  }
  set(x,position.x);
  await new Promise(resolve=>setTimeout(resolve,100));
  const currentY=field('Y');
  if(!currentY)return {ok:false,error:'修改 X 后未找到 Y 输入框'};
  set(currentY,position.y);
  return {ok:true};
}
