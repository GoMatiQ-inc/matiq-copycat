const api=globalThis.browser||chrome;
const identity=globalThis.GUIDES_IDENTITY;
const KEY='guidesCapture',MAX_PENDING=4,MAX_BUFFER_BYTES=3*1024*1024;
let state={phase:'idle',scope:null,capture:null,receiver:null,instance:'',outbox:[],nextSequence:0,error:'',warnings:[],pendingCancel:false,serverRevision:0};
let port=null,ready=null,heartbeat=null,active=false,generation=0,baseline=null,queue=Promise.resolve(),queued=0,navigationExpected=false,lastScreenshot=0,screenshotWait=null;
const pending=new Map();
const safeError=error=>String(error?.message||error||'Capture interrupted. Review the guide before continuing.').replace(/(?:https?|file):\/\/[^\s"'<>]+/gi,'the selected page').slice(0,1000);
const initialized=(async()=>{const stored=(await api.storage.local.get(KEY))[KEY];if(stored){state={...state,...stored};if(state.phase==='recording'){state.phase='paused';state.error='The extension restarted. Reconnect, reconcile pending steps and explicitly resume.';}}await persist();})();
async function persist(){await api.storage.local.set({[KEY]:state});if(state.scope)await api.action.setBadgeText({tabId:state.scope.tabId,text:active?'REC':state.phase==='paused'?'II':''}).catch(()=>{});}
function enqueue(operation){if(++queued>12){queued--;deactivate();return Promise.reject(Error('The capture queue is full. Recording stopped; review pending steps before resuming.'));}const result=queue.then(()=>initialized).then(operation);queue=result.catch(()=>{}).finally(()=>queued--);return result;}
async function tell(command,extra={}){if(!state.scope)return;return api.tabs.sendMessage(state.scope.tabId,{type:'guides-control',command,...extra});}
function deactivate(){active=false;generation++;baseline=null;if(state.scope)api.action.setBadgeText({tabId:state.scope.tabId,text:''}).catch(()=>{});if(screenshotWait){clearTimeout(screenshotWait.timer);screenshotWait.resolve();screenshotWait=null;}if(state.scope)tell('stop').catch(()=>{});}
function nativeError(message){deactivate();for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error(message));}pending.clear();ready=null;port=null;clearInterval(heartbeat);enqueue(async()=>{state.phase=state.capture&&['recording','paused'].includes(state.capture.phase)?'paused':state.phase;state.error=message||'';await persist();}).catch(()=>{});}
async function connect(){
 if(ready)return ready;
 if(port)throw Error('A connection is already opening. Retry shortly.');
 const connection=api.runtime.connectNative(identity.nativeHost);port=connection;
 const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reject(Error('The native bridge did not respond. Open Guides and check its bridge setup.'));port?.disconnect();},10000);
  port.onMessage.addListener(message=>{
   if(message?.v!==1){nativeError('Bridge protocol mismatch. Update the extension and receiving tool together.');return;}
   if(message.type==='ready'){clearTimeout(timer);ready={receiver:message.receiver,instance:message.instance};resolve(ready);heartbeat=setInterval(()=>rpc('status').catch(()=>{}),15000);return;}
   if(message.type==='error'){clearTimeout(timer);const error=message.error||'The native bridge failed. Reconnect before recording.';reject(Error(error));nativeError(error);return;}
   if(message.type==='event'){if(message.event?.type==='finish-request'||message.event?.type==='pause-request'||message.event?.type==='status'&&message.event.status.revision>=state.serverRevision&&message.event.status.capture?.phase!=='recording')deactivate();enqueue(()=>onNativeEvent(message.event)).catch(error=>fail(error));return;}
   const entry=pending.get(message.requestId);if(entry){pending.delete(message.requestId);clearTimeout(entry.timer);message.error?entry.reject(Error(message.error)):entry.resolve(message.result);}
  });
  connection.onDisconnect.addListener(()=>{clearTimeout(timer);if(port!==connection)return;const message=api.runtime.lastError?.message||'Native bridge disconnected. Open Guides and reconnect; capture is paused.';reject(Error(message));nativeError(message);});
 });
 return started;
}
async function rpc(type,payload={}){if(!ready||!port)throw Error('Connect to the native bridge first.');const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Guides did not acknowledge the action. Capture paused; reconnect to retry it.'));},10000);pending.set(requestId,{resolve,reject,timer});try{port.postMessage({v:1,requestId,type,receiver:state.receiver,...payload});}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}});}
async function fail(error){deactivate();state.phase='paused';state.error=safeError(error);await persist();if(ready&&state.capture?.phase==='recording'){try{const result=await rpc('issue',{reason:state.error});state.capture=result.capture;state.serverRevision=result.revision;await persist();}catch{state.error+=' The desktop pause is awaiting reconnection.';await persist();}}}
async function chooseTab(){const [tab]=await api.tabs.query({active:true,currentWindow:true});if(!tab||!/^https?:\/\//.test(tab.url||''))throw Error('Select an HTTP(S) page. Browser-internal pages, extension pages and local files are unsupported.');const origin=new URL(tab.url).origin;return {tabId:tab.id,windowId:tab.windowId,origin};}
async function activate(){
 const token=++generation;if(!state.scope||!state.capture||state.capture.phase!=='recording')throw Error('Select a guide session and tab before recording.');
 await api.windows.update(state.scope.windowId,{focused:true});if(token!==generation||!ready)throw Error('Capture was interrupted before activation. Reconnect and explicitly resume.');
 await api.scripting.executeScript({target:{tabId:state.scope.tabId},files:['content.js']});if(token!==generation||!ready)throw Error('Capture was interrupted before activation. Reconnect and explicitly resume.');
 active=true;const context=await tell('start');if(token!==generation||!ready){await tell('stop');throw Error('Capture was paused during activation. Explicitly resume when ready.');}
 state.phase='recording';state.error='';await persist();await snapshot(context);
}
const viewportEqual=(a,b)=>a&&b&&['width','height','x','y','scale','dpr'].every(key=>a[key]===b[key]);
async function visible(){const [tab]=await api.tabs.query({active:true,windowId:state.scope.windowId});const window=await api.windows.get(state.scope.windowId);if(tab?.id!==state.scope.tabId||!window.focused)throw Error('The selected tab is no longer visible in the focused browser window. Return to it and explicitly resume.');return tab;}
async function compress(data){if(data.length<=950000)return {mediaType:data.startsWith('data:image/png')?'image/png':'image/jpeg',data:data.split(',')[1]};const blob=await (await fetch(data)).blob(),image=await createImageBitmap(blob);try{for(const factor of [.85,.65,.45]){const canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*factor)),Math.max(1,Math.round(image.height*factor)));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg',quality:.9})).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));const encoded=btoa(text);if(encoded.length<=950000)return {mediaType:'image/jpeg',data:encoded};}throw Error('This screenshot exceeds the bridge limit. Use a smaller browser window before resuming.');}finally{image.close();}}
function closeConnection(){deactivate();clearInterval(heartbeat);heartbeat=null;const connection=port;port=null;ready=null;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('The bridge connection was closed explicitly. Reconnect before continuing.'));}pending.clear();connection?.disconnect();}
async function waitScreenshot(){const delay=550-(Date.now()-lastScreenshot);if(delay>0)await new Promise(resolve=>{screenshotWait={resolve,timer:setTimeout(()=>{screenshotWait=null;resolve();},delay)};});if(!active)throw Error('Capture is paused.');}
async function screenshot(){const token=generation;await waitScreenshot();await visible();await tell('indicator',{visible:false});try{if(!active||generation!==token)throw Error('Capture paused before the screenshot.');lastScreenshot=Date.now();const data=await api.tabs.captureVisibleTab(state.scope.windowId,{format:'jpeg',quality:95});if(!active||generation!==token)throw Error('Capture paused while the screenshot was pending. Review this action manually.');return await compress(data);}finally{if(active)await tell('indicator',{visible:true}).catch(()=>{});}}
const documentTransitionError=error=>/back.forward cache|bfcache|message channel.*closed|receiving end does not exist|could not establish connection|frame.*removed|context invalidated/i.test(error?.message||'');
function priorImage(context){return baseline?.context.doc===context.doc&&baseline.context.revision===context.revision&&viewportEqual(baseline.context.viewport,context.viewport)&&Date.now()-baseline.at<2000?baseline.image:null;}
async function snapshot(context){
 if(!active)return;const token=generation;
 try{await waitScreenshot();const before=await tell('context');if(context&&before.doc!==context.doc)return;const image=await screenshot(),after=await tell('context');if(active&&token===generation&&before.doc===after.doc&&before.revision===after.revision&&viewportEqual(before.viewport,after.viewport))baseline={image,context:after,at:Date.now()};}
 catch(error){if(!documentTransitionError(error))throw error;/* The baseline is optional. A canonical action still needs a verified image or a visible interruption. */}
}
async function flush(){while(state.outbox.length){const event=state.outbox[0];const result=await rpc('step',{event});if(result.id!==event.id||result.ack!==event.sequence||result.session!==event.session)throw Error('Guides returned an unexpected acknowledgement. Keep the buffer and reconnect.');state.outbox.shift();state.serverRevision=Math.max(state.serverRevision,result.revision);await persist();}}
async function append(event,context){
 if(!active)return;const token=generation,cached=priorImage(context);let image,target=context.target,origin=context.origin,action=event.action,warning='';
 await waitScreenshot();const before=await tell('context',{id:event.id}).catch(error=>{if(documentTransitionError(error))return null;throw error;});
 if(before&&before.doc===context.doc){
  try{
   image=await screenshot();const after=await tell('context',{id:event.id});
   if(after.doc!==context.doc||!viewportEqual(before.viewport,after.viewport)||before.revision!==after.revision){if(cached)image=cached;else throw Error('The page changed before a reliable action screenshot could be captured. This action was not saved. Review it and add a manual step.');}
   else if(JSON.stringify(after.target)!==JSON.stringify(context.target)){target=null;warning='An interaction target changed before its screenshot. Review and highlight that step manually.';}
  }catch(error){if(cached&&documentTransitionError(error))image=cached;else throw error;}
 }else if(cached)image=cached;
 else{
  const current=await tell('context').catch(()=>null);if(!current)throw Error('Navigation interrupted the action screenshot. Reconnect on the new page and review the missing action.');image=await screenshot();origin=current.origin;target=null;action='navigate';warning='Navigation completed before the action screenshot; a navigation instruction was recorded.';
 }
 if(!active||token!==generation)return;
 const value={id:event.id,session:state.capture.id,scope:state.capture.scope,sequence:state.nextSequence,at:event.at,source:'browser',origin,action,control:event.control,label:event.label,target,image};
 if(state.outbox.length>=MAX_PENDING||JSON.stringify([...state.outbox,value]).length>MAX_BUFFER_BYTES)throw Error('The pending buffer reached four steps or 3 MiB. Recording stopped. Reconnect and flush it before continuing.');
 state.outbox.push(value);state.nextSequence++;if(event.navigationExpected)navigationExpected=true;if(warning)state.warnings.push(warning);await persist();await flush();if(warning)await rpc('warning',{reason:warning});
}
async function onNativeEvent(event){if(event?.type==='pause-request'){deactivate();await tell('stop').catch(error=>{if(!documentTransitionError(error))throw error;});state.phase='paused';state.error=event.reason;await persist();await rpc('quiesced',{control:event.control});return;}if(event?.type==='finish-request'){await ui('stop');return;}if(event?.type!=='status')return;const status=event.status;if(status.revision<state.serverRevision)return;state.serverRevision=status.revision;if(state.capture&&status.capture?.id!==state.capture.id&&state.outbox.length){deactivate();state.error='The receiving guide session changed. Reconnect to the original session or explicitly discard pending steps.';await persist();return;}const wasActive=state.capture&&['recording','paused'].includes(state.capture.phase);state.capture=status.capture;state.instance=status.instance;if(status.capture?.phase!=='recording'){deactivate();state.phase=status.capture?.phase||'idle';if(wasActive&&['stopped','cancelled'].includes(state.phase)){if(state.phase==='cancelled')state.outbox=[];closeConnection();}}await persist();}
async function chooseScope(){const selected=await chooseTab();if(state.scope&&state.scope.tabId!==selected.tabId)await api.action.setBadgeText({tabId:state.scope.tabId,text:''}).catch(()=>{});state.scope=selected;}
async function ui(command){
 if(command==='status')return {...state,connected:!!ready,available:ready,bufferLimits:{steps:MAX_PENDING,bytes:MAX_BUFFER_BYTES},outbox:state.outbox.map(e=>({id:e.id,sequence:e.sequence})),capture:state.capture?{id:state.capture.id,phase:state.capture.phase,savedSteps:state.capture.receipts.length}:null};
 if(command==='disconnect'){deactivate();if(ready&&state.capture&&['recording','paused'].includes(state.capture.phase)){const result=await rpc('issue',{reason:'Browser bridge disconnected explicitly. Reconnect and resume before recording more steps.'});state.capture=result.capture;state.serverRevision=result.revision;state.phase='paused';}await persist();closeConnection();return ui('status');}
 if(command==='connect'){await connect();return ui('status');}
 if(command==='select'){if(!ready)await connect();const status=await rpc('select',{receiver:ready.receiver});if(state.outbox.length&&status.capture?.id!==state.capture?.id)throw Error('Pending steps belong to another guide session. Reopen it before reconnecting, or explicitly discard the buffer.');state.receiver=ready.receiver;state.instance=ready.instance;state.capture=status.capture;state.serverRevision=status.revision;state.phase=status.capture?.phase||'idle';if(state.pendingCancel){await rpc('control',{command:'cancel'});state.pendingCancel=false;state.outbox=[];state.phase='cancelled';}else await flush();state.nextSequence=(await rpc('status')).capture?.receipts.length||0;state.error='';await persist();return ui('status');}
 if(command==='start'){if(state.outbox.length)throw Error('Reconcile pending steps before starting another capture.');if(!ready||state.receiver!==ready.receiver)throw Error('Connect and select the receiving instance first.');await chooseScope();const status=await rpc('start',{origin:state.scope.origin});state.capture=status.capture;state.serverRevision=status.revision;state.nextSequence=0;state.warnings=[];await activate();await append({id:crypto.randomUUID(),at:Date.now(),action:'navigate',control:'link',label:''},await tell('context'));return ui('status');}
 if(command==='resume'){if(!state.capture)throw Error('Start a guide capture first.');await chooseScope();await flush();const status=await rpc('control',{command:'resume'});state.capture=status.capture;state.serverRevision=status.revision;await activate();return ui('status');}
 if(command==='pause'){deactivate();await flush();const status=await rpc('control',{command:'pause'});state.capture=status.capture;state.serverRevision=status.revision;state.phase='paused';await persist();return ui('status');}
 if(command==='stop'){deactivate();await flush();const status=await rpc('control',{command:'stop'});state.capture=status.capture;state.serverRevision=status.revision;state.phase='stopped';state.scope=null;await persist();closeConnection();return ui('status');}
 if(command==='cancel'){deactivate();state.outbox=[];if(ready){const status=await rpc('control',{command:'cancel'});state.capture=status.capture;state.serverRevision=status.revision;state.phase='cancelled';state.scope=null;await persist();closeConnection();}else{state.pendingCancel=true;state.phase='paused';state.error='Cancellation is pending on the desktop. Reconnect and select that session to finish it.';await persist();}return ui('status');}
 if(command==='discard'){deactivate();if(!ready)throw Error('Reconnect before discarding pending steps, so the desktop can retain the incomplete-capture warning.');await rpc('issue',{reason:'Pending extension steps were explicitly discarded. The guide may be incomplete; review it before sharing.'});state.outbox=[];state.nextSequence=(await rpc('status')).capture?.receipts.length||0;state.phase='paused';await persist();return ui('status');}
 throw Error('Unknown extension control.');
}
api.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='ui'&&sender.id===api.runtime.id&&sender.url===api.runtime.getURL('popup.html')){if(['pause','stop','cancel','discard','disconnect'].includes(message.command))deactivate();enqueue(()=>ui(message.command)).then(result=>reply({result}),error=>{fail(error).finally(()=>reply({error:safeError(error)}));});return true;}
 if(message?.type==='capture'&&active&&sender.tab?.id===state.scope?.tabId&&sender.frameId===0){
  if(message.command==='action'&&message.event?.navigationExpected)navigationExpected=true;
  enqueue(async()=>{if(!active)return;if(message.command==='action')await append(message.event,message.context);else if(message.command==='baseline')await snapshot(message.context);else if(message.command==='navigation'){if(navigationExpected){navigationExpected=false;await snapshot(message.context);}else await append({id:crypto.randomUUID(),at:Date.now(),action:'navigate',control:'link',label:''},message.context);}else if(message.command==='warning'){state.warnings.push(String(message.reason).slice(0,1000));state.warnings=state.warnings.slice(-16);await persist();await rpc('warning',{reason:String(message.reason).slice(0,1000)});}else if(message.command==='interrupted'){await fail(Error(message.reason));}else throw Error('Unsupported page capture message.');}).then(()=>reply({accepted:true}),error=>fail(error).finally(()=>reply({error:safeError(error)})));return true;
 }
 reply({error:'This page is outside the selected recording scope.'});
});
api.tabs.onActivated.addListener(info=>{if(active&&info.tabId!==state.scope?.tabId){deactivate();enqueue(()=>fail(Error('The active tab changed. Select the intended tab and explicitly resume.'))).catch(()=>{});}});
api.tabs.onRemoved.addListener(id=>{if(id===state.scope?.tabId){deactivate();enqueue(()=>fail(Error('The selected tab closed. Review the guide and choose another tab before resuming.'))).catch(()=>{});}});
api.tabs.onUpdated.addListener((id,change)=>{
 if(!active||id!==state.scope?.tabId||change.status!=='complete')return;const token=generation;
 // Establish the new document outside the action queue so a departing click can inspect it. Canonical steps remain serialized.
 (async()=>{await api.scripting.executeScript({target:{tabId:id},files:['content.js']});if(!active||token!==generation)return;const context=await tell('start');if(!active||token!==generation){await tell('stop');return;}await enqueue(async()=>{if(!active)return;if(navigationExpected){navigationExpected=false;await snapshot(context);}else await append({id:crypto.randomUUID(),at:Date.now(),action:'navigate',control:'link',label:''},context);});})().catch(error=>fail(error));
});
