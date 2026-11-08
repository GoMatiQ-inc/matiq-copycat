const path=require('node:path');
let enabled=false;
const SDK='0.1.3',RUNTIME='electron-45.2.3';
function releaseSummary(info){
 if(!info||info.toolId!=='com.matiq.guides'||info.sdkVersion!==SDK||info.runtime!==RUNTIME||info.dataVersion!==1)throw Error('This update needs a different SDK, runtime or project format. Keep your saved work and wait for a qualified compatible release.');
 if(typeof info.version!=='string'||!/^\d+\.\d+\.\d+$/.test(info.version)||info.version.length>60)throw Error('The update version is invalid. Retry after the release metadata is corrected.');
 const candidates=Array.isArray(info.files)?info.files.filter(f=>f&&f.url==='MatiQ-Copycat-'+info.version+'-mac-arm64.zip'):[],file=candidates.length===1?candidates[0]:null;
 if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>1024**3||typeof file.sha512!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512))throw Error('The update is missing a valid arm64 ZIP, size or integrity hash. Retry after the release metadata is corrected.');
 return {version:info.version,bytes:file.size};
}
function create(host){
 const {app,autoUpdater:native,dialog}=require('electron');
 if(!enabled||process.platform!=='darwin'||process.arch!=='arm64'||!app.isPackaged)return {snapshot:()=>({enabled:false}),busy:()=>false,reason:()=>'',dispose:async()=>{},command:()=>{throw Error('Use the suite update controls or a qualified standalone macOS application.');}};
 const {MacUpdater,NoOpLogger}=require('electron-updater'),{ElectronAppAdapter}=require('electron-updater/out/ElectronAppAdapter'),{ElectronHttpExecutor}=require('electron-updater/out/electronHttpExecutor'),{CancellationToken}=require('node:module').createRequire(require.resolve('electron-updater'))('builder-util-runtime');
 if(require('electron-updater/package.json').version!=='6.8.9')throw Error('Reconcile the pinned standalone updater before launching this build.');
 const requests=new Set(),listeners=[];
 let phase='idle',offer=null,detail='',progress=0,pending=null,cancellation=null,restart=false,restartTimer=null,disposed=false,nativePending=false;
 const emit=()=>host.emit('com.matiq.guides:state',{updateOnly:true,updates:snapshot()});
 const snapshot=()=>({enabled:true,current:app.getVersion(),phase,offer,detail,progress,busy:!!pending||phase==='checking'||phase==='downloading'||phase==='verifying'||phase==='cleanup'||nativePending});
 function state(next,text=''){phase=next;detail=text;emit();}
 class LocalApp extends ElectronAppAdapter{get userDataPath(){return path.join(host.dataDir,'updates');}get baseCachePath(){return this.userDataPath;}}
 class OwnedExecutor extends ElectronHttpExecutor{
  createRequest(options,callback){
   if(options.headers)for(const key of Object.keys(options.headers))if(key.toLowerCase()==='x-user-staging-id')delete options.headers[key];
   const request=super.createRequest(options,callback);requests.add(request);
   let timer;const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>request.abort(),45000);};arm();
   request.once('response',response=>response.on('data',arm));request.once('close',()=>{clearTimeout(timer);requests.delete(request);});return request;
  }
 }
 // These two internals are audited against pinned 6.8.9: suppress its persisted rollout ID and close its owned Squirrel proxy.
 class LocalUpdater extends MacUpdater{getOrCreateStagingUserId(){return Promise.resolve('00000000-0000-4000-8000-000000000000');}}
 const previousNative=new Map(['error','update-downloaded'].map(event=>[event,native.listeners(event)]));
 const updater=new LocalUpdater(undefined,new LocalApp(app));
 const nativeListeners=Array.from(previousNative,([event,previous])=>native.listeners(event).filter(fn=>!previous.includes(fn)).map(fn=>[event,fn])).flat();updater.httpExecutor=new OwnedExecutor();
 updater.logger=new NoOpLogger();updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;
 updater.disableDifferentialDownload=true;updater.isUserWithinRollout=()=>true;
 function listen(target,event,fn){target.on(event,fn);listeners.push([target,event,fn]);}
 listen(updater,'error',()=>{});listen(updater,'download-progress',value=>{progress=Math.max(0,Math.min(100,Math.round(value.percent)));emit();});
 async function closeProxy(){
  const server=updater.server;if(!server)return;
  if(server.listening)await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
  if(server.listening)throw Error('The update transfer is still open. Retry update cleanup before closing.');
 }
 async function idleRequests(){
  const deadline=Date.now()+5000;while(requests.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  if(requests.size)throw Error('The update connection has not stopped. Retry update cleanup before closing.');
 }
 function abort(){cancellation?.cancel();for(const request of requests)request.abort();}
 async function verifyNative(){
  nativePending=true;state('verifying','Verifying the signed update locally. Keep Copycat open; it will be staged for the next safe restart.');
  await new Promise((resolve,reject)=>{
   let timer;
   const clear=()=>{clearTimeout(timer);native.removeListener('update-downloaded',ready);native.removeListener('error',failed);};
   const ready=()=>{nativePending=false;clear();resolve();},failed=()=>{nativePending=false;clear();reject(Error('macOS could not verify or stage the update. Keep the current version and retry downloading.'));};
   native.once('update-downloaded',ready);native.once('error',failed);
   timer=setTimeout(()=>{detail='Update verification is taking longer than expected. Keep Copycat open; waiting for macOS to stop safely.';emit();closeProxy().catch(()=>state('cleanup','Update transfer cleanup failed. Keep Copycat open and choose Retry update cleanup after macOS verification finishes.'));},120000);
   try{native.checkForUpdates();}catch{nativePending=false;clear();reject(Error('macOS could not begin update verification. Retry downloading.'));}
  });
 }
 function launch(operation){
  pending=(async()=>{try{await operation();await idleRequests();}catch(error){abort();try{await closeProxy();await idleRequests();}catch{state('cleanup','The update connection did not close. Choose Retry update cleanup.');return;}state('error',error.safeMessage||'The update did not finish. Your saved guides are unchanged. Check the connection and retry.');}finally{cancellation?.dispose();cancellation=null;pending=null;emit();}})();
 }
 function willQuit(event){
  if(!restart)return;event.preventDefault();app.removeListener('will-quit',willQuit);
  setImmediate(()=>{const failed=()=>{native.removeListener('error',failed);dialog.showErrorBox('Update could not restart','The guide workspace closed safely, but macOS did not restart the update. Reopen MatiQ Copycat to continue.');setImmediate(()=>app.quit());};native.once('error',failed);app.once('quit',()=>native.removeListener('error',failed));try{native.quitAndInstall();}catch{failed();}});
 }
 app.on('will-quit',willQuit);
 async function command(action){
  if(disposed)throw Error('Reopen Copycat before checking for updates.');
  if(action==='cleanup'){
   if(nativePending)throw Error('macOS is still verifying the update. Keep Copycat open until it reports success or failure.');
   abort();await closeProxy();await idleRequests();if(pending)await pending;state('error','Update connections stopped. Check for updates again when ready.');return snapshot();
  }
  if(pending||phase==='cleanup')throw Error('Wait for the update operation to finish or retry update cleanup.');
  if(action==='check'){
   if(phase==='ready')return snapshot();
   state('checking','Checking the published release. No guide content is sent.');
   launch(async()=>{const result=await updater.checkForUpdates();if(!result)throw Error('Packaged updater is unavailable.');let summary;try{summary=releaseSummary(result.updateInfo);}catch(error){error.safeMessage=error.message;throw error;}if(!result.isUpdateAvailable){offer=null;state('current','This version is current.');return;}offer=summary;state('available','A compatible update is available. Download only when you choose.');});
  }else if(action==='download'){
   if(phase!=='available'||!offer)throw Error('Check for a compatible update before downloading.');
   cancellation=new CancellationToken();progress=0;state('downloading','Downloading the update. Your saved guides remain local.');
   launch(async()=>{await updater.downloadUpdate(cancellation);await verifyNative();await closeProxy();state('ready','Verified and staged. It will apply at the next safe launch; Restart now also reopens Copycat.');});
  }else if(action==='restart'){
   if(phase!=='ready')throw Error('Download and verify a compatible update before restarting.');
   restart=true;detail='Restart requested. The SDK will first check saved work and stop capture resources.';emit();
   clearTimeout(restartTimer);restartTimer=setTimeout(()=>{if(!disposed){restart=false;detail='Restart did not complete. Save or finish pending work, then choose Restart now again.';emit();}},10000);
   setImmediate(()=>app.quit());
  }else throw Error('Choose Check for updates, Download update, Restart now or Retry update cleanup.');
  return snapshot();
 }
 return {snapshot,command,busy:()=>!!pending||phase==='cleanup'||nativePending||requests.size>0,reason:()=>phase==='cleanup'?'Retry update cleanup before closing.':'Wait for the update check, download or local verification to finish.',async dispose(){
  if(disposed)return;
  if(nativePending)throw Error('Wait for macOS update verification to finish before closing.');
  abort();if(pending)await pending;try{await closeProxy();await idleRequests();}catch(error){state('cleanup','Update connections did not stop. Choose Retry update cleanup before closing.');throw error;}clearTimeout(restartTimer);
  for(const [target,event,fn] of listeners)target.removeListener(event,fn);
  // MacUpdater itself installs exactly these two native listeners at construction.
  for(const [event,owned] of nativeListeners)native.removeListener(event,owned);
  if(!restart)app.removeListener('will-quit',willQuit);disposed=true;
 }};
}
module.exports={enable(){enabled=true;},create,releaseSummary};
