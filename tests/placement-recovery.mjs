import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const key='placement-origin:/design/test:default';
const saved={top:0,right:1440,nodeId:'old'};
const data={[key]:saved,frameGap:500};
const event={addListener(){}};
let fail=true,axis='X',current={ok:true,x:9000,y:100,width:1440,nodeId:'new'};
const context=vm.createContext({URL,Date,importScripts(){},figmaPlacement(){},setTimeout:fn=>{fn();},chrome:{
  runtime:{onInstalled:event,onStartup:event,onMessage:event,sendNativeMessage:async(_,m)=>{
    if(fail)return {ok:false,error:'simulated helper failure'};
    current[axis==='X'?'x':'y']=Number(m.value);return {ok:true};
  }},
  tabs:{get:async()=>({url:'https://www.figma.com/design/test/File',title:'File Figma'})},
  storage:{local:{get:async k=>({[k]:data[k]}),set:async values=>Object.assign(data,values)}},
  scripting:{executeScript:async({args})=>{
    if(args[0]==='focusAxis'){axis=args[1].axis;return [{result:{ok:true}}];}
    return [{result:{...current}}];
  }}
}});
vm.runInContext(readFileSync('extension/background.js','utf8'),context);
const result=await context.arrangeWeb(1,{nodeId:'old'});
assert.equal(result.ok,false);
assert.deepEqual(data[key],saved,'failure must not erase or advance last confirmed position');
fail=false;
const next=await context.arrangeWeb(1,{nodeId:'failed-paste'});
assert.equal(next.ok,true);
assert.equal(data[key].right,3380);
assert.equal(current.x,1940,'next capture resumes at last successful right edge + 500');
assert.equal(current.y,0);
data['placement-page:/design/test']='12-34';
assert.equal(await context.placementStorageKey({url:'https://www.figma.com/design/test/File?node-id=99-1'}),'placement-origin:/design/test:12-34');
console.log('Failure preserves placement; next success resumes at +500; missing page-id retains scope.');
