import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const event={addListener(){}};
const context=vm.createContext({
  importScripts(){},chrome:{runtime:{onInstalled:event,onStartup:event,onMessage:event}},
  URL,AbortSignal,Uint8Array,btoa,
  fetch:async url=>new Response(new Uint8Array([1,2,3]),{status:200,headers:{'content-type':url.endsWith('.png')?'image/png':'text/html'}})
});
vm.runInContext(readFileSync('extension/background.js','utf8'),context);
const result=await context.support({cmd:'H2D_FETCH_ASSETS',payload:{urls:['https://example.com/a.png','https://example.com/no-image']}},{});
assert.equal(result[0].blob.type,'image/png');
assert.equal(result[0].blob.base64Blob,'data:image/png;base64,AQID');
assert.equal(result[1].blob,null);
assert.equal(result[1].error,'recovery_failed');
console.log('Asset recovery matches competitor blob contract; non-image assets rejected.');
