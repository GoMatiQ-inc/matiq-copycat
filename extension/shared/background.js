const api=globalThis.browser||chrome;
const identity=globalThis.GUIDES_IDENTITY;
const KEY='guidesCapture',MAX_PENDING=4,MAX_BUFFER_BYTES=3*1024*1024;
let state={phase:'idle',scope:null,capture:null,receiver:null,instance:'',outbox:[],nextSequence:0,error:'',warnings:[],pendingCancel:false,serverRevision:0};
let port=null,ready=null,opening=null,rejectOpening=null,heartbeat=null,active=false,generation=0,baseline=null,queue=Promise.resolve(),queued=0,navigationExpected=false,lastNavigation=null,lastScreenshot=0,screenshotWait=null;
const pending=new Map(),unrecordedActions=new Set();
const safeError=error=>/Missing host permission|permission.*capture|capture.*permission/i.test(error?.message||'')?'Browser access ended during navigation. Capture stopped and this action may be missing. Open the extension on the new page and explicitly resume. In Firefox, optionally enable continuous page navigation before resuming. Review the guide before sharing.':String(error?.message||error||'Capture interrupted. Review the guide before continuing.').replace(/(?:https?|file):\/\/[^\s"'<>]+/gi,'the selected page').slice(0,1000);
const initialized=(async()=>{const stored=(await api.storage.local.get(KEY))[KEY];if(stored){state={...state,...stored};if(state.phase==='recording'){state.phase='paused';state.error='The extension restarted. Reconnect, reconcile pending steps and explicitly resume.';}if(state.scope&&['recording','paused'].includes(state.phase)){let timer;try{const result=await Promise.race([tell('stop'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The selected page did not confirm stop.')),2000);})]);if(result?.stopped!==true)throw Error('The selected page did not confirm stop.');}catch{state.error=(state.error?state.error+' ':'')+'The previous page could not confirm its capture hooks stopped. Reload that selected page before resuming; review pending steps.';}finally{clearTimeout(timer);}}}await persist();})();
async function persist(){await api.storage.local.set({[KEY]:state});if(state.scope)await api.action.setBadgeText({tabId:state.scope.tabId,text:active?'REC':state.phase==='paused'?'II':''}).catch(()=>{});}
function enqueue(operation){if(++queued>12){queued--;deactivate();return Promise.reject(Error('The capture queue is full. Recording stopped; review pending steps before resuming.'));}const result=queue.then(()=>initialized).then(operation);queue=result.catch(()=>{}).finally(()=>queued--);return result;}
async function tell(command,extra={}){if(!state.scope)return;let timer;try{return await Promise.race([api.tabs.sendMessage(state.scope.tabId,{type:'guides-control',command,...extra}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The selected page did not answer capture control within two seconds. Review the guide and explicitly resume when the page responds.')),2000);})]);}finally{clearTimeout(timer);}}
function deactivate(){active=false;generation++;baseline=null;if(state.scope)api.action.setBadgeText({tabId:state.scope.tabId,text:''}).catch(()=>{});if(screenshotWait){clearTimeout(screenshotWait.timer);screenshotWait.resolve();screenshotWait=null;}if(state.scope)tell('stop').catch(()=>{});}
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
function validStatus(value){const capture=value?.capture;return !!value&&revision(value.revision)&&value.receiver===ready?.receiver&&typeof value.instance==='string'&&value.instance.length>0&&value.instance.length<=200&&(capture===null||!!capture&&uuid(capture.id)&&uuid(capture.scope)&&['recording','paused','stopped','cancelled'].includes(capture.phase)&&Array.isArray(capture.receipts)&&capture.receipts.length<=500&&capture.receipts.every(uuid)&&new Set(capture.receipts).size===capture.receipts.length);}
function nativeError(message,connection,disconnected=false){if(port!==connection)return;closeConnection(message,!disconnected);state.phase=state.capture&&['recording','paused'].includes(state.capture.phase)?'paused':state.phase;state.error=message;enqueue(()=>persist()).catch(()=>{state.error=message+' Recovery state could not be saved. Keep the extension open and retry before closing it.';});}
async function connect(){
 if(ready)return ready;
 if(opening)return opening;
 const connection=api.runtime.connectNative(identity.nativeHost);port=connection;
 const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>nativeError('The native bridge did not respond. Open Copycat and check its bridge setup.',connection),10000);
  rejectOpening=error=>{clearTimeout(timer);reject(error);};
  connection.onMessage.addListener(message=>{
   if(port!==connection)return;
   if(message?.v!==1){nativeError('Bridge protocol mismatch. Update the extension and receiving tool together.',connection);return;}
   if(message.type==='ready'){
    if(ready||!uuid(message.receiver)||typeof message.instance!=='string'||!message.instance.length||message.instance.length>200){nativeError('The native bridge returned an invalid handshake. Update the approved bridge and extension together.',connection);return;}
    clearTimeout(timer);opening=null;rejectOpening=null;ready={receiver:message.receiver,instance:message.instance};resolve(ready);heartbeat=setInterval(()=>rpc('status').catch(()=>{}),15000);return;
   }
   if(message.type==='error'){const error=typeof message.error==='string'&&message.error.length<=1000?message.error:'The native bridge returned an invalid error. Update the approved bridge and reconnect.';nativeError(error||'The native bridge failed. Reconnect before recording.',connection);return;}
   if(!ready){nativeError('The native bridge sent data before its handshake. Update the approved bridge and reconnect.',connection);return;}
   if(message.type==='event'){const event=message.event;if(!event||!['status','pause-request','finish-request'].includes(event.type)||event.type==='status'&&!validStatus(event.status)||event.type==='pause-request'&&(!uuid(event.control)||typeof event.reason!=='string'||event.reason.length>1000)){nativeError('The native bridge returned an invalid capture event. Update the approved bridge and reconnect; review pending steps.',connection);return;}if(message.event?.type==='finish-request'||message.event?.type==='pause-request'||message.event?.type==='status'&&message.event.status.revision>=state.serverRevision&&message.event.status.capture?.phase!=='recording')deactivate();enqueue(()=>onNativeEvent(message.event)).catch(error=>fail(error));return;}
   const entry=pending.get(message.requestId);if(entry){const hasError=Object.hasOwn(message,'error'),hasResult=Object.hasOwn(message,'result'),result=message.result;const valid=hasError!==hasResult&&(hasError?typeof message.error==='string'&&message.error.length>0&&message.error.length<=1000:entry.type==='step'?!!result&&uuid(result.id)&&uuid(result.session)&&revision(result.revision)&&Number.isSafeInteger(result.ack)&&result.ack>=0&&result.ack<500:entry.type==='quiesced'?result?.acknowledged===true:validStatus(result));if(!valid){nativeError('The native bridge returned an invalid acknowledgement. Keep pending steps and reconnect to the approved receiver.',connection);return;}pending.delete(message.requestId);clearTimeout(entry.timer);hasError?entry.reject(Error(message.error)):entry.resolve(result);}
  });
  connection.onDisconnect.addListener(()=>{clearTimeout(timer);if(port!==connection)return;const message=api.runtime.lastError?.message||connection.error?.message||'Native bridge disconnected. Open Copycat and reconnect; capture is paused.';nativeError(message,connection,true);});
 });
 opening=started;return started;
}
async function rpc(type,payload={}){if(!ready||!port)throw Error('Connect to the native bridge first.');const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Copycat did not acknowledge the action. Capture paused; reconnect to retry it.'));},10000);pending.set(requestId,{resolve,reject,timer,type});try{port.postMessage({v:1,requestId,type,receiver:state.receiver,...payload});}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}});}
async function fail(error){if(error?.code==='GUIDES_CAPTURE_INTERRUPTED')return;if(!active&&state.phase==='paused'&&state.error)return;deactivate();state.phase='paused';state.error=safeError(error);await persist();if(ready&&state.capture?.phase==='recording'){try{const result=await rpc('issue',{reason:state.error});state.capture=result.capture;state.serverRevision=result.revision;await persist();}catch{state.error+=' The desktop pause is awaiting reconnection.';await persist();}}}
async function chooseTab(){const [tab]=await api.tabs.query({active:true,currentWindow:true});if(!tab||!/^https?:\/\//.test(tab.url||''))throw Error('Select an HTTP(S) page. Browser-internal pages, extension pages and local files are unsupported.');const origin=new URL(tab.url).origin;return {tabId:tab.id,windowId:tab.windowId,origin};}
async function activate(){
 const token=++generation;if(!state.scope||!state.capture||state.capture.phase!=='recording')throw Error('Select a guide session and tab before recording.');
 await api.windows.update(state.scope.windowId,{focused:true});if(token!==generation||!ready)throw Error('Capture was interrupted before activation. Reconnect and explicitly resume.');
 await api.scripting.executeScript({target:{tabId:state.scope.tabId},files:['content.js']});if(token!==generation||!ready)throw Error('Capture was interrupted before activation. Reconnect and explicitly resume.');
 active=true;const context=await tell('start');if(!uuid(context.navigation))throw Error('The selected page capture adapter is outdated. Reload that page and explicitly resume after updating the extension.');lastNavigation=context.navigation;if(token!==generation||!ready){await tell('stop');throw Error('Capture was paused during activation. Explicitly resume when ready.');}
 state.phase='recording';state.error='';await persist();await snapshot(context);
}
const viewportEqual=(a,b)=>a&&b&&['width','height','x','y','scale','dpr'].every(key=>a[key]===b[key]);
async function visible(){const [tab]=await api.tabs.query({active:true,windowId:state.scope.windowId});const window=await api.windows.get(state.scope.windowId);if(!/^https?:\/\//.test(tab?.url||''))throw Error('The selected tab navigated to an unsupported page. Capture stopped; choose an HTTP(S) page and explicitly resume.');if(tab?.id!==state.scope.tabId||!window.focused)throw Error('The selected tab is no longer visible in the focused browser window. Return to it and explicitly resume.');return tab;}
async function compress(data){if(data.length<=950000)return {mediaType:data.startsWith('data:image/png')?'image/png':'image/jpeg',data:data.split(',')[1]};const blob=await (await fetch(data)).blob(),image=await createImageBitmap(blob);try{for(const factor of [.85,.65,.45]){const canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*factor)),Math.max(1,Math.round(image.height*factor)));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg',quality:.9})).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));const encoded=btoa(text);if(encoded.length<=950000)return {mediaType:'image/jpeg',data:encoded};}throw Error('This screenshot exceeds the bridge limit. Use a smaller browser window before resuming.');}finally{image.close();}}
function closeConnection(message='The bridge connection was closed explicitly. Reconnect before continuing.',disconnect=true){deactivate();clearInterval(heartbeat);heartbeat=null;const connection=port;port=null;ready=null;opening=null;const reject=rejectOpening;rejectOpening=null;reject?.(Error(message));for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error(message));}pending.clear();if(disconnect)connection?.disconnect();}
async function waitScreenshot(){const delay=550-(Date.now()-lastScreenshot);if(delay>0)await new Promise(resolve=>{screenshotWait={resolve,timer:setTimeout(()=>{screenshotWait=null;resolve();},delay)};});if(!active)throw Object.assign(Error('Capture is paused.'),{code:'GUIDES_CAPTURE_INTERRUPTED'});}
async function screenshot(){const token=generation;await waitScreenshot();await visible();await tell('indicator',{visible:false});try{if(!active||generation!==token)throw Error('Capture paused before the screenshot.');lastScreenshot=Date.now();const data=await api.tabs.captureVisibleTab(state.scope.windowId,{format:'jpeg',quality:95});if(!active||generation!==token)throw Error('Capture paused while the screenshot was pending. Review this action manually.');return await compress(data);}finally{if(active)await tell('indicator',{visible:true}).catch(()=>{});}}
const documentTransitionError=error=>error?.code==='GUIDES_DOCUMENT_TRANSITION'||/back.forward cache|bfcache|message channel.*closed|receiving end does not exist|could not establish connection|frame.*removed|context invalidated/i.test(error?.message||'');
function priorImage(context){return baseline?.context.doc===context.doc&&baseline.context.revision===context.revision&&viewportEqual(baseline.context.viewport,context.viewport)&&Date.now()-baseline.at<2000?baseline.image:null;}
async function snapshot(context){
 if(!active)return;const token=generation;
 try{await waitScreenshot();const before=await tell('context');if(context&&before.doc!==context.doc)return;const image=await screenshot(),after=await tell('context');if(active&&token===generation&&before.doc===after.doc&&before.revision===after.revision&&viewportEqual(before.viewport,after.viewport))baseline={image,context:after,at:Date.now()};}
 catch(error){if(!documentTransitionError(error))throw error;/* The baseline is optional. A canonical action still needs a verified image or a visible interruption. */}
}
async function flush(){while(state.outbox.length){const event=state.outbox[0];const result=await rpc('step',{event});if(result.id!==event.id||result.ack!==event.sequence||result.session!==event.session)throw Error('Copycat returned an unexpected acknowledgement. Keep the buffer and reconnect.');state.outbox.shift();state.serverRevision=Math.max(state.serverRevision,result.revision);await persist();}}
async function navigationSnapshot(previous,token){
 const deadline=Date.now()+3000;
 for(let attempt=0;attempt<60&&active&&token===generation&&Date.now()<deadline;attempt++){
  try{
   const before=await tell('context');
   if(before.doc!==previous.doc||before.navigation!==previous.navigation){
    const image=await screenshot(),after=await tell('context');
    if(before.doc===after.doc&&before.navigation===after.navigation&&before.revision===after.revision&&viewportEqual(before.viewport,after.viewport))return {image,context:after};
   }
  }catch(error){if(!documentTransitionError(error))throw error;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 if(!active||token!==generation)return null;
 throw Error('Navigation did not produce a stable screenshot within three seconds. Capture paused; reopen the extension on the new page and review the missing action.');
}
async function append(event,context){
 if(!active)return;unrecordedActions.add(event.id);const token=generation,cached=priorImage(context);let image,target=context.target,origin=context.origin,action=event.action,warning='',navigationFallback=false;
 await waitScreenshot();const before=await tell('context',{id:event.id}).catch(error=>{if(documentTransitionError(error))return null;throw error;});
 if(before&&before.doc===context.doc){
  try{
   image=await screenshot();const after=await tell('context',{id:event.id});
   if(after.doc!==context.doc||after.navigation!==context.navigation)throw Object.assign(Error('The selected document navigated during screenshot capture.'),{code:'GUIDES_DOCUMENT_TRANSITION'});
   if(!viewportEqual(before.viewport,after.viewport)||before.revision!==after.revision){if(cached)image=cached;else throw Error('The page changed before a reliable action screenshot could be captured. This action was not saved. Review it and add a manual step.');}
   else if(JSON.stringify(after.target)!==JSON.stringify(context.target)){target=null;warning='An interaction target changed before its screenshot. Review and highlight that step manually.';}
  }catch(error){
   if(!documentTransitionError(error))throw error;
   if(cached)image=cached;
   else{const settled=await navigationSnapshot(context,token);if(!settled)return;image=settled.image;origin=settled.context.origin;target=null;action='navigate';navigationFallback=true;warning='Navigation completed before the action screenshot; a navigation instruction was recorded.';}
  }
 }else if(cached)image=cached;
 else{
  const settled=await navigationSnapshot(context,token);if(!settled)return;image=settled.image;origin=settled.context.origin;target=null;action='navigate';navigationFallback=true;warning='Navigation completed before the action screenshot; a navigation instruction was recorded.';
 }
 if(!active||token!==generation)return;
 const value={id:event.id,session:state.capture.id,scope:state.capture.scope,sequence:state.nextSequence,at:event.at,source:'browser',origin,action,control:event.control,label:event.label,target,image};
 if(state.outbox.length>=MAX_PENDING||JSON.stringify([...state.outbox,value]).length>MAX_BUFFER_BYTES)throw Error('The pending buffer reached four steps or 3 MiB. Recording stopped. Reconnect and flush it before continuing.');
 state.outbox.push(value);state.nextSequence++;if(event.navigationExpected||navigationFallback)navigationExpected=true;if(warning)state.warnings.push(warning);await persist();unrecordedActions.delete(event.id);await flush();if(warning)await rpc('warning',{reason:warning});
}
async function recordNavigation(event,context){
 if(context.navigation&&context.navigation===lastNavigation){unrecordedActions.delete(event.id);await snapshot(context);return;}
 lastNavigation=context.navigation;
 if(navigationExpected){navigationExpected=false;unrecordedActions.delete(event.id);await snapshot(context);}else await append(event,context);
}
async function warnInterruptedActions(){if(!unrecordedActions.size)return;const reason='A browser action was not saved when capture stopped. The guide may be incomplete; review it and add a manual step before sharing.';await rpc('warning',{reason});unrecordedActions.clear();if(!state.warnings.includes(reason))state.warnings.push(reason);await persist();}
async function onNativeEvent(event){if(event?.type==='pause-request'){deactivate();await tell('stop').catch(error=>{if(!documentTransitionError(error))throw error;});state.phase='paused';state.error=event.reason;await warnInterruptedActions();await persist();await rpc('quiesced',{control:event.control});return;}if(event?.type==='finish-request'){await ui('stop');return;}if(event?.type!=='status')return;const status=event.status;if(status.revision<state.serverRevision)return;state.serverRevision=status.revision;if(state.capture&&status.capture?.id!==state.capture.id&&state.outbox.length){deactivate();state.error='The receiving guide session changed. Reconnect to the original session or explicitly discard pending steps.';await persist();return;}const wasActive=state.capture&&['recording','paused'].includes(state.capture.phase);state.capture=status.capture;state.instance=status.instance;if(status.capture?.phase!=='recording'){deactivate();state.phase=status.capture?.phase||'idle';if(state.phase==='paused'&&ready)await warnInterruptedActions();if(wasActive&&['stopped','cancelled'].includes(state.phase)){if(state.phase==='cancelled'){state.outbox=[];unrecordedActions.clear();}closeConnection();}}await persist();}
async function chooseScope(){const selected=await chooseTab();if(state.scope&&state.scope.tabId!==selected.tabId)await api.action.setBadgeText({tabId:state.scope.tabId,text:''}).catch(()=>{});state.scope=selected;}
async function ui(command){
 if(command==='status')return {...state,connected:!!ready,available:ready,bufferLimits:{steps:MAX_PENDING,bytes:MAX_BUFFER_BYTES},outbox:state.outbox.map(e=>({id:e.id,sequence:e.sequence})),capture:state.capture?{id:state.capture.id,phase:state.capture.phase,savedSteps:state.capture.receipts.length}:null};
 if(command==='disconnect'){deactivate();if(ready)await warnInterruptedActions();if(ready&&state.capture&&['recording','paused'].includes(state.capture.phase)){const result=await rpc('issue',{reason:'Browser bridge disconnected explicitly. Reconnect and resume before recording more steps.'});state.capture=result.capture;state.serverRevision=result.revision;state.phase='paused';}await persist();closeConnection();return ui('status');}
 if(command==='connect'){await connect();return ui('status');}
 if(command==='select'){if(!ready)await connect();const status=await rpc('select',{receiver:ready.receiver});if(state.outbox.length&&status.capture?.id!==state.capture?.id)throw Error('Pending steps belong to another guide session. Reopen it before reconnecting, or explicitly discard the buffer.');state.receiver=ready.receiver;state.instance=ready.instance;state.capture=status.capture;state.serverRevision=status.revision;state.phase=status.capture?.phase||'idle';if(state.pendingCancel){await rpc('control',{command:'cancel'});state.pendingCancel=false;state.outbox=[];state.phase='cancelled';}else await flush();state.nextSequence=(await rpc('status')).capture?.receipts.length||0;state.error='';await persist();return ui('status');}
 if(command==='start'){if(state.outbox.length)throw Error('Reconcile pending steps before starting another capture.');if(!ready||state.receiver!==ready.receiver)throw Error('Connect and select the receiving instance first.');await chooseScope();const status=await rpc('start',{origin:state.scope.origin});state.capture=status.capture;state.serverRevision=status.revision;state.nextSequence=0;state.warnings=[];await activate();await append({id:crypto.randomUUID(),at:Date.now(),action:'navigate',control:'link',label:''},await tell('context'));return ui('status');}
 if(command==='resume'){if(!state.capture)throw Error('Start a guide capture first.');await chooseScope();await flush();const status=await rpc('control',{command:'resume'});state.capture=status.capture;state.serverRevision=status.revision;await activate();return ui('status');}
 if(command==='pause'){deactivate();await flush();await warnInterruptedActions();const status=await rpc('control',{command:'pause'});state.capture=status.capture;state.serverRevision=status.revision;state.phase='paused';await persist();return ui('status');}
 if(command==='stop'){deactivate();await flush();await warnInterruptedActions();const status=await rpc('control',{command:'stop'});state.capture=status.capture;state.serverRevision=status.revision;state.phase='stopped';state.scope=null;await persist();closeConnection();return ui('status');}
 if(command==='cancel'){deactivate();state.outbox=[];unrecordedActions.clear();if(ready){const status=await rpc('control',{command:'cancel'});state.capture=status.capture;state.serverRevision=status.revision;state.phase='cancelled';state.scope=null;await persist();closeConnection();}else{state.pendingCancel=true;state.phase='paused';state.error='Cancellation is pending on the desktop. Reconnect and select that session to finish it.';await persist();}return ui('status');}
 if(command==='discard'){deactivate();if(!ready)throw Error('Reconnect before discarding pending steps, so the desktop can retain the incomplete-capture warning.');await rpc('issue',{reason:'Pending extension steps were explicitly discarded. The guide may be incomplete; review it before sharing.'});state.outbox=[];state.nextSequence=(await rpc('status')).capture?.receipts.length||0;state.phase='paused';await persist();return ui('status');}
 throw Error('Unknown extension control.');
}
api.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type==='ui'&&sender.id===api.runtime.id&&sender.url===api.runtime.getURL('popup.html')){if(['pause','stop','cancel','discard','disconnect'].includes(message.command))deactivate();enqueue(()=>ui(message.command)).then(result=>reply({result}),error=>{fail(error).finally(()=>reply({error:safeError(error)}));});return true;}
 if(message?.type==='capture'&&active&&sender.tab?.id===state.scope?.tabId&&sender.frameId===0){
  if(message.command==='action'){unrecordedActions.add(message.event?.id);if(message.event?.navigationExpected)navigationExpected=true;}
  const navigation=message.command==='navigation'?{id:crypto.randomUUID(),at:Date.now(),action:'navigate',control:'link',label:''}:null;if(navigation&&!navigationExpected)unrecordedActions.add(navigation.id);
  enqueue(async()=>{if(!active)return;if(message.command==='action')await append(message.event,message.context);else if(message.command==='baseline')await snapshot(message.context);else if(message.command==='navigation'){await recordNavigation(navigation,message.context);}else if(message.command==='warning'){state.warnings.push(String(message.reason).slice(0,1000));state.warnings=state.warnings.slice(-16);await persist();await rpc('warning',{reason:String(message.reason).slice(0,1000)});}else if(message.command==='interrupted'){await fail(Error(message.reason));}else throw Error('Unsupported page capture message.');}).then(()=>reply({accepted:true}),error=>fail(error).finally(()=>reply({error:safeError(error)})));return true;
 }
 reply({error:'This page is outside the selected recording scope.'});
});
api.tabs.onActivated.addListener(info=>{if(active&&info.tabId!==state.scope?.tabId){deactivate();enqueue(()=>fail(Error('The active tab changed. Select the intended tab and explicitly resume.'))).catch(()=>{});}});
api.tabs.onRemoved.addListener(id=>{if(id===state.scope?.tabId){deactivate();enqueue(()=>fail(Error('The selected tab closed. Review the guide and choose another tab before resuming.'))).catch(()=>{});}});
api.tabs.onUpdated.addListener((id,change)=>{
 if(!active||id!==state.scope?.tabId||change.status!=='complete')return;const token=generation;
 // Establish the new document outside the action queue so a departing click can inspect it. Canonical steps remain serialized.
 (async()=>{const tab=await api.tabs.get(id);if(!/^https?:\/\//.test(tab.url||''))throw Error('The selected tab navigated to an unsupported page. Capture stopped; choose an HTTP(S) page and explicitly resume.');await api.scripting.executeScript({target:{tabId:id},files:['content.js']});if(!active||token!==generation)return;const context=await tell('start');if(!active||token!==generation){await tell('stop');return;}const navigation={id:crypto.randomUUID(),at:Date.now(),action:'navigate',control:'link',label:''};if(!navigationExpected)unrecordedActions.add(navigation.id);await enqueue(async()=>{if(!active)return;await recordNavigation(navigation,context);});})().catch(error=>fail(error));
});
