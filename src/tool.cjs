const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {app, dialog, BrowserWindow, nativeImage, systemPreferences} = require('electron');
const C=require('./capture.cjs'),B=require('./bridge.cjs'),D=require('./desktop.cjs'),N=require('./narration.cjs');
const identities=require('../extension/identities.json');
const P = require('./project.cjs');
const {documentation,markdown,exportRequest,warningSteps}=require('./export.cjs');
exports.activate = async host => {
  const library=path.join(host.dataDir,'guides');await fs.mkdir(library,{recursive:true,mode:0o700});
  let current=null,file=null,release=null,exportUnlock=null,exportFailure='',dirty=false,working=false,saveState='saved',failure='',disposed=false,disposing=false;
  const updates=require('./standalone-updates.cjs').create(host);
  const windows=new Set();let bridge=null,browserOwner=null,finishPending=false,stateRevision=0,pendingInterruption=null,quiesce=null;
  let desktopChoices=[],desktop=null,desktopQueue=Promise.resolve(),desktopAccepting=false,desktopCutoff=0,desktopInterrupting=null,desktopPending=0,desktopPendingBytes=0;
  let narration=null;
  const desktopLimits={steps:4,bytes:3*1024*1024};
  const activeCapture=()=>current?.capture&&['recording','paused'].includes(current.capture.phase);
  const snapshot=()=>({revision:stateRevision,project:current,file:file?path.basename(file):null,saveState,unsaved:dirty,error:failure||exportFailure,exportCleanup:!!exportUnlock&&!!exportFailure,updates:updates.snapshot(),narration:narration?.status(),desktop:{active:!!desktop,accepting:desktopAccepting,pending:desktopPending,bytes:desktopPendingBytes,limits:desktopLimits},bridge:bridge?{receiver:bridge.receiver,instance:app.getName(),connected:!!browserOwner,finishPending}:null});
  const notify=()=>{host.emit('com.matiq.guides:state',snapshot());bridge?.broadcast({type:'status',status:browserStatus()});};
  narration=N.create({host,app,dialog,systemPreferences,changed:notify,apply:async(job,attach,segments)=>{if(current?.guide.id!==job.guide||current?.capture?.id!==job.capture||current.capture.phase==='cancelled')throw Error('Retained narration belongs to another capture. Open its original saved guide before retrying.');desktopQueue=desktopQueue.then(()=>captureWrite(attach(current,segments)));await desktopQueue;}});
  function browserStatus(){return {revision:stateRevision,receiver:bridge?.receiver,instance:app.getName(),guide:current?{id:current.guide.id,title:current.guide.title}:null,capture:current?.capture?.source==='desktop'?null:current?.capture||null,finishPending};}
  async function cleanupExport(){if(!exportUnlock)return;try{await exportUnlock();exportUnlock=null;exportFailure='';}catch(error){exportFailure='Export destination cleanup failed ('+(error.code||'ownership changed')+'). Reconnect its storage or resolve its ownership record, then choose Retry export cleanup. Your local guide remains saved.';throw Error(exportFailure);}}
  async function captureWrite(next){saveState='saving';notify();try{await P.atomicWrite(file,next);current=next;stateRevision++;saveState='saved';dirty=false;failure='';notify();}catch(error){saveState='failed';failure='Capture was not saved. Reconnect and retry the pending step: '+error.message;notify();throw Error(failure);}}
  async function captureControl(command,reason=''){if(command==='stop'||command==='cancel')finishPending=false;if(!current)throw Error('Create or open a guide first.');await captureWrite(command==='start'?C.begin(current):C.transition(current,command,reason));return snapshot();}
  async function endWork(){working=false;const reason=pendingInterruption;pendingInterruption=null;if(reason&&activeCapture()){working=true;try{await captureWrite(current.capture.phase==='recording'?C.transition(current,'pause',reason):C.warn(current,reason));}finally{working=false;}}}
  async function quiesceBrowser(reason='Copycat is closing. Browser capture stopped; reopen and explicitly resume when ready.'){
    if(quiesce)return quiesce.promise;
    if(!browserOwner||browserOwner.socket.destroyed||!activeCapture()||current.capture.source==='desktop')return;
    let timer;const confirmation=new Promise((resolve,reject)=>{quiesce={id:randomUUID(),resolve};timer=setTimeout(()=>reject(Error('The browser did not confirm that capture stopped. Reconnect it and retry the capture control or closing Copycat.')),5000);bridge.broadcast({type:'pause-request',control:quiesce.id,reason});});quiesce.promise=confirmation;
    try{await confirmation;}finally{clearTimeout(timer);quiesce=null;}
  }
  async function enableBridge(){
    if(bridge)return;
    bridge=await B.start({directory:path.join(app.getPath('appData'),'MatiQ Solutions','Guides Bridge'),instance:app.getName(),origins:[`chrome-extension://${identities.chromiumId}/`,identities.firefoxId],report:error=>{failure='Browser bridge cleanup needs attention: '+error.message;notify();},
      disconnect:async client=>{if(browserOwner!==client)return;quiesce?.resolve();browserOwner=null;finishPending=false;if(disposing)return;if(current?.capture?.phase==='recording'&&current.capture.source!=='desktop'){if(working){pendingInterruption='The browser disconnected during an operation. Recording stopped; reconnect and review pending steps.';failure=pendingInterruption;notify();return;}working=true;try{await captureControl('pause','Browser disconnected. Recording stopped; reconnect and review pending steps.');}finally{await endWork();}}notify();},
      receive:async(message,client)=>{
        if(message.type==='quiesced'&&client===browserOwner&&quiesce?.id===message.control){quiesce.resolve();return {acknowledged:true};}
        if(disposing||disposed)throw Error('Copycat is closing. Reopen it before reconnecting.');
        if(message.type==='status')return browserStatus();
        if(message.type==='select'){if(message.receiver!==bridge.receiver)throw Error('Choose the currently displayed receiving instance.');if(browserOwner&&browserOwner!==client)throw Error('Another browser owns this capture. Stop or disconnect it before selecting this browser.');browserOwner=client;finishPending=false;notify();return browserStatus();}
        if(browserOwner!==client||message.receiver!==bridge.receiver)throw Error('Select this receiving instance explicitly before recording.');
        if(activeCapture()&&current.capture.source==='desktop')throw Error('Desktop capture owns this guide. Stop it in Copycat before recording browser actions.');
        if(exportUnlock)throw Error('Retry export cleanup in Copycat before recording.');
        if(working)throw Error('Copycat is saving or awaiting a dialog. Retry the unacknowledged action shortly.');working=true;
        try{
          if(message.type==='start'){if(dirty||await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)'))throw Error('Save the current guide before starting capture.');if(!current)throw Error('Create or open a guide in the desktop app first.');const origin=P.httpOrigin(message.origin,'Select a normal HTTP(S) browser page.');const approval=await dialog.showMessageBox(host.window,{type:'question',message:'Record this browser workflow?',detail:`Append steps from the selected tab at ${origin} to “${current.guide.title}”. Screenshots may contain sensitive information. Review and redact before sharing.`,buttons:['Cancel','Start capture'],cancelId:0,defaultId:0});if(approval.response!==1)throw Error('Capture was not started.');if(client.socket.destroyed||browserOwner!==client)throw Error('The browser disconnected before approval. Capture did not start; reconnect and try again.');await captureControl('start');await endWork();return browserStatus();}
          if(message.type==='step'){const result=C.append(current,message.event);if(!result.duplicate)await captureWrite(result.project);await endWork();return {revision:stateRevision,session:current.capture.id,ack:message.event.sequence,id:message.event.id};}
          if(message.type==='control'&&['pause','resume','stop','cancel'].includes(message.command)){const expected={pause:'paused',resume:'recording',stop:'stopped',cancel:'cancelled'}[message.command];if(current?.capture?.phase===expected)return browserStatus();await captureControl(message.command);await endWork();return browserStatus();}
          if(message.type==='warning'){await captureWrite(C.warn(current,message.reason));await endWork();return browserStatus();}
          if(message.type==='issue'){if(!activeCapture())throw Error('No active capture.');const reason=String(message.reason||'Capture interrupted. Review the guide before continuing.').slice(0,1000);const next=current.capture.phase==='recording'?C.transition(current,'pause',reason):C.warn(current,reason);await captureWrite(next);await endWork();return browserStatus();}
          throw Error('Unsupported Copycat bridge command.');
        }finally{await endWork();}
      }});notify();
  }
  async function stopDesktop(cancelVoice=false){
    desktopCutoff=desktopCutoff||Date.now();desktopAccepting=false;const owned=desktop;
    if(owned){await owned.stop();if(desktop===owned)desktop=null;}
    try{await host.view.webContents.executeJavaScript('window.guidesStopVoice ? window.guidesStopVoice() : Promise.resolve()');}catch{narration.reportError('input');}
    try{await narration.finish({cancel:cancelVoice});}catch(error){failure=error.message;if(activeCapture())await captureWrite(C.warn(current,'Narration incomplete. '+error.message));}
    await desktopQueue;
  }
  function desktopInterrupted(error){
    desktopAccepting=false;
    if(desktopInterrupting)return;
    failure='Desktop capture stopped: '+error.message;notify();
    desktopInterrupting=(async()=>{
      try{
        await stopDesktop();
        if(disposing||disposed)return;
        if(working){pendingInterruption=error.message;return;}
        if(activeCapture()){
          working=true;
          try{await captureWrite(current.capture.phase==='recording'?C.transition(current,'pause',error.message):C.warn(current,error.message));}finally{await endWork();}
        }
      }catch(cleanup){failure='Desktop capture cleanup failed. Retry pause or closing Copycat: '+cleanup.message;notify();}
      finally{desktopInterrupting=null;}
    })();
  }
  async function startDesktop(choice){
    desktopCutoff=0;desktopAccepting=true;
    try{
      desktop=await D.start(host,choice.id,choice.pid,event=>{
        if(!desktopAccepting&&(!desktop||event.at>desktopCutoff))return;
        const bytes=Buffer.byteLength(JSON.stringify(event));
        if(desktopPending>=desktopLimits.steps||desktopPendingBytes+bytes>desktopLimits.bytes){
          desktopInterrupted(Error('Native pending delivery reached its limit (4 steps or 3 MiB). Capture stopped; some actions may be missing. Review saved steps and resume more slowly after storage recovers.'));return;
        }
        desktopPending++;desktopPendingBytes+=bytes;
        desktopQueue=desktopQueue.then(async()=>{
          const capture=current.capture;
          const result=C.append(current,{...event,id:randomUUID(),session:capture.id,scope:capture.scope,sequence:capture.receipts.length});
          try{await captureWrite(result.project);}catch(error){current=result.project;stateRevision++;throw error;}
        }).catch(error=>{queueMicrotask(()=>desktopInterrupted(error));}).finally(()=>{desktopPending--;desktopPendingBytes-=bytes;notify();});
      },desktopInterrupted,command=>{void (async()=>{try{await stopDesktop(command==='cancel');if(disposing||disposed)return;if(working)throw Error('Recording stopped from the menu bar. Finish the current operation, then use the capture controls.');working=true;try{await captureControl(command);}finally{await endWork();}}catch(error){desktopInterrupted(error);}})();});
    }catch(error){desktopAccepting=false;throw error;}
  }
  async function idle(){if(activeCapture())throw Error('Stop or cancel capture before switching guides.');if(dirty)throw Error('Save your guide before switching or closing it.');}
  async function closeProject(){if(release){await release();release=null;}current=null;file=null;dirty=false;}
  async function open(target) {
    await idle();if(target===file)return snapshot();const unlock=await P.lock(target);
    try {
      let loaded=await P.read(target),recovered=false;
      const candidates=[];
      for(const suffix of ['.pending','.draft','.draft.pending']){
        try{const stat=await fs.lstat(target+suffix);if(stat.isFile()&&!stat.isSymbolicLink())candidates.push({path:target+suffix,time:stat.mtimeMs});}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      candidates.sort((a,b)=>b.time-a.time);
      if(candidates.length){
        const choice=await dialog.showMessageBox(host.window,{type:'warning',message:'Interrupted work is available.',detail:'Recover the latest draft or pending save, or keep the last completed save. Your saved guide remains intact until you save recovered work.',buttons:['Recover latest work','Keep last save','Cancel'],cancelId:2,defaultId:0});
        if(choice.response===2){await unlock();return snapshot();}
        if(choice.response===0){loaded=await P.read(candidates[0].path);if(loaded.guide.id!==(await P.read(target)).guide.id)throw Error('Recovery identity differs from the saved guide. Import a verified copy separately.');recovered=true;}
        else for(const candidate of candidates)await fs.unlink(candidate.path);
      }
      if(loaded.capture?.phase==='recording')loaded=C.transition(loaded,'pause','Capture was interrupted. Reconnect explicitly before recording more actions.');
      await closeProject();current=loaded;await narration.recover(current);file=target;release=unlock;stateRevision++;dirty=recovered;saveState=dirty?'unsaved':'saved';failure='';return snapshot();
    }catch(error){await unlock();throw error;}
  }
  async function save(){if(!current)throw Error('Open or create a guide first.');saveState='saving';failure='';try{await P.atomicWrite(file,current);for(const suffix of ['.draft','.draft.pending']){try{await fs.unlink(file+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}}dirty=false;stateRevision++;saveState='saved';}catch(error){saveState='failed';failure='Saving failed. Keep this guide open and retry: '+error.message;throw Error(failure);}return snapshot();}
  async function flattened(sanitized=false) {
    const result=P.clone(current);result.assets={};delete result.capture;
    for(let i=0;i<result.guide.steps.length;i++){
      const s=result.guide.steps[i],original=current.guide.steps[i];
      if(s.asset){
        const source=current.assets[s.asset];
        const data=await host.view.webContents.executeJavaScript(`window.guidesRender(${JSON.stringify({step:original,asset:source})})`);
        if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw Error('Screenshot rendering failed. Reopen the guide before exporting.');
        s.asset=P.addImage(result,Buffer.from(data.slice(22),'base64'));s.annotations=[];s.crop=null;
      }
      s.source=null;
      if(sanitized){s.notes='';s.timestamp=0;}
    }
    if(sanitized)result.guide.steps.push(...warningSteps(current.capture?.issues||[],500-result.guide.steps.length));
    return P.compact(result);
  }
  host.handle('com.matiq.guides:request',async(name,args)=>{
    if(disposed||disposing)throw Error('Reopen Copycat before continuing.');
    if(name==='state')return snapshot();
    if(name==='voice-error'){if(!['input','limit'].includes(args))throw Error('Unsupported microphone status.');narration.reportError(args);return;}
    if(name==='voice-chunk')return narration.chunk(args);
    if(name==='voice-cancel-download'){narration.cancelDownload();return;}

    if(name.startsWith('update-')){if(args!==undefined)throw Error('Update actions do not accept paths or configuration.');if(name==='update-restart'){const status=await toolStatus();if(status.busy)throw Error(status.reason);}return updates.command(name.slice(7));}
    if(exportUnlock&&!['export-cleanup','export'].includes(name))throw Error('Retry export cleanup before continuing.');
    if(name==='dirty'){if(activeCapture())throw Error('Stop capture before editing steps.');dirty=true;saveState='unsaved';return;}
    if(name==='capture-control'&&args==='stop'&&activeCapture()&&current.capture.source!=='desktop'&&browserOwner&&!browserOwner.socket.destroyed){if(!finishPending){finishPending=true;bridge.broadcast({type:'finish-request'});notify();}return snapshot();}
    if(name==='capture-control'&&['pause','cancel'].includes(args)&&activeCapture()&&current.capture.source!=='desktop'&&browserOwner&&!browserOwner.socket.destroyed){
      await quiesceBrowser(args==='pause'?'Capture paused from Copycat. Explicitly resume from the selected browser tab when ready.':'Capture cancellation requested from Copycat. Recording stopped while pending delivery settles.');
      if(disposing||disposed)throw Error('Copycat is closing. Capture has stopped; reopen it before continuing.');
      if(args==='pause'&&current.capture.phase==='paused')return snapshot();
      if(working)throw Error('Capture stopped. Wait for the current save to finish, then retry the control.');working=true;
      try{await captureControl(args);return snapshot();}finally{await endWork();}
    }
    if(working)throw Error('Wait for the current operation to finish.');working=true;
    try {
      if(name==='voice-prepare')return narration.prepare();
      if(name==='voice-begin'){if(!current||current.capture?.source!=='desktop'||current.capture.phase!=='recording'||!desktopAccepting||args!==current.capture.id)throw Error('Start desktop recording before enabling its microphone.');return narration.begin(current);}
      if(name==='voice-retry'){if(!current||activeCapture()||dirty||await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)'))throw Error('Stop recording and save edits before retrying narration.');await narration.retry(current);return snapshot();}
      if(name==='export-cleanup'){await cleanupExport();return snapshot();}
      if(name==='bridge-enable'){await enableBridge();return snapshot();}
      if(name==='bridge-install'){return require('./bridge-install.cjs').install({host,browser:args});}
      if(name==='desktop-list'){
        if(activeCapture()&&current.capture.phase==='recording')throw Error('Pause or stop capture before selecting another window.');
        const choice=await dialog.showMessageBox(host.window,{type:'info',message:'Select a desktop workflow window',detail:'Copycat will request Screen Recording permission to list windows. Recording starts only after you choose a window and approve it. Browser workflows use the extension instead.',buttons:['Cancel','Choose window'],cancelId:0,defaultId:0});
        desktopChoices=choice.response===1?await D.list(host):[];return desktopChoices;
      }
      if(name==='desktop-workflow'){
        if(!current||dirty||await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)'))throw Error('Create and save a guide before recording.');
        if(activeCapture()&&!(current.capture.source==='desktop'&&current.capture.phase==='paused'))throw Error('Stop the current capture before recording the desktop.');
        await captureWrite(activeCapture()?C.transition(current,'resume'):C.begin(current,'desktop'));
        try{await startDesktop({id:0,pid:0});}catch(error){await captureWrite(C.transition(current,'pause',error.message));throw error;}
        notify();return snapshot();
      }
      if(name==='desktop-start'){
        if(!current||dirty||await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)'))throw Error('Create and save a guide before recording.');
        if(activeCapture()&&!(current.capture.source==='desktop'&&current.capture.phase==='paused'))throw Error('Stop the current capture before recording a desktop window.');
        const selected=desktopChoices.find(w=>w.id===args);if(!selected)throw Error('Refresh the window list and select a visible application window.');
        const choice=await dialog.showMessageBox(host.window,{type:'warning',message:'Record the selected desktop window?',detail:'Selected application: '+selected.application+'. Only mouse actions in the selected foreground window are captured. Accessibility permission provides control labels; field values and keystrokes are never read. Screenshots can contain secrets. Browser windows, menus, dialogs and other windows are outside this scope. Review and redact before sharing.',buttons:['Cancel','Start recording'],cancelId:0,defaultId:0});
        if(choice.response!==1)return snapshot();
        await captureWrite(activeCapture()?C.transition(current,'resume'):C.begin(current,'desktop'));
        try{await startDesktop(selected);}catch(error){await captureWrite(C.transition(current,'pause',error.message));throw error;}
        notify();return snapshot();
      }
      if(name==='capture-control'){if(!['pause','resume','stop','cancel'].includes(args))throw Error('Choose a supported capture control.');if(current?.capture?.source==='desktop'){
        if(args==='resume')throw Error('Refresh the desktop window list and choose Start / resume selected window explicitly.');
        await stopDesktop(args==='cancel');if(desktopInterrupting)await desktopInterrupting;const reason=pendingInterruption||'';pendingInterruption=null;await captureControl(args,reason);return snapshot();
      }if(args==='resume')throw Error('Resume from the extension to explicitly select the visible browser tab.');if(args==='stop'&&(!browserOwner||browserOwner.socket.destroyed)&&activeCapture()){const choice=await dialog.showMessageBox(host.window,{type:'warning',message:'Finish without a connected browser?',detail:'Unacknowledged extension steps may still be pending. Reconnect to deliver them, or finish with an incomplete-capture warning.',buttons:['Reconnect first','Finish with saved steps only'],cancelId:0,defaultId:0});if(choice.response!==1)return snapshot();await captureControl('stop','Capture finished without a connected browser. Pending steps may be missing; review before sharing.');return snapshot();}await captureControl(args);return snapshot();}
      if(activeCapture()&&!['list'].includes(name))throw Error('Stop or cancel capture before editing, switching or exporting.');
      if(name==='list'){
        const names=(await fs.readdir(library)).filter(n=>n.endsWith('.mqguide'));const rows=[];
        for(const n of names){try{const p=await P.read(path.join(library,n));rows.push({id:p.guide.id,title:p.guide.title,description:p.guide.description,steps:p.guide.steps.length});}catch{rows.push({id:n.slice(0,-8),title:'Unreadable guide — import a recovered copy',description:'This project failed validation. Its original file has been preserved.',steps:0,invalid:true});}}return rows;
      }
      if(name==='new'){
        if(dirty)throw Error('Save the current guide before creating another.');const project=P.create();const target=path.join(library,project.guide.id+'.mqguide');const unlock=await P.lock(target);
        try{await P.atomicWrite(target,project);await closeProject();current=project;file=target;release=unlock;stateRevision++;saveState='saved';return snapshot();}catch(error){await unlock();throw error;}
      }
      if(name==='open'){
        if(typeof args!=='string'||!/^[a-f0-9-]{36}$/.test(args))throw Error('Select a valid guide from the library.');
        return await open(path.join(library,args+'.mqguide'));
      }
      if(name==='import'){
        if(dirty)throw Error('Save the current guide before importing another.');const choice=await dialog.showOpenDialog(host.window,{properties:['openFile'],filters:[{name:'Editable MatiQ guide',extensions:['mqguide']}]});
        if(choice.canceled)return snapshot();let project=await P.read(choice.filePaths[0]);if(project.capture?.phase==='recording')project=C.transition(project,'pause','An interrupted capture was imported. Reconnect explicitly before recording more steps.');
        const target=path.join(library,project.guide.id+'.mqguide');
        try{await fs.access(target);throw Error('This guide already exists in the library. Duplicate it explicitly before importing another copy.');}catch(error){if(error.code!=='ENOENT')throw error;}
        const unlock=await P.lock(target);
        try{await P.atomicWrite(target,project);await closeProject();current=project;file=target;release=unlock;stateRevision++;saveState='saved';return snapshot();}catch(error){await unlock();throw error;}
      }
      if(name==='draft'){
        if(!current)throw Error('Open a guide before saving a recovery draft.');const checked=P.validate(args);if(checked.guide.id!==current.guide.id)throw Error('Recovery draft identity changed. Reopen before editing.');await P.atomicWrite(file+'.draft',checked);return {saved:true};
      }
      if(name==='save'){
        if(!current)throw Error('Open a guide first.');const checked=P.validate(args);if(checked.guide.id!==current.guide.id)throw Error('Guide ownership changed. Reopen before saving.');current=checked;dirty=true;return await save();
      }
      if(name==='duplicate'){
        if(!current||dirty)throw Error('Save the guide before duplicating it.');const copy=P.clone(current);copy.guide.id=randomUUID();copy.guide.title+=' (copy)';await P.atomicWrite(path.join(library,copy.guide.id+'.mqguide'),copy);return snapshot();
      }
      if(name==='delete'){
        if(!current||dirty)throw Error('Save the current guide before deleting it.');const answer=await dialog.showMessageBox(host.window,{type:'warning',message:'Delete this local guide?',detail:'This permanently removes this library copy and its embedded screenshots. Portable exports are separate files.',buttons:['Keep guide','Delete guide'],cancelId:0,defaultId:0});if(answer.response===1){await fs.unlink(file);for(const suffix of ['.pending','.draft','.draft.pending']){try{await fs.unlink(file+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}}await closeProject();stateRevision++;}return snapshot();
      }
      if(name==='image'){
        const choice=await dialog.showOpenDialog(host.window,{properties:['openFile'],filters:[{name:'Screenshot',extensions:['png','jpg','jpeg']}]});if(choice.canceled)return null;
        const stat=await fs.stat(choice.filePaths[0]);if(stat.size>16*1024*1024)throw Error('Choose a screenshot under 16 MiB.');const bytes=await fs.readFile(choice.filePaths[0]),asset=P.image(bytes),decoded=nativeImage.createFromBuffer(bytes),size=decoded.getSize();
        if(decoded.isEmpty()||size.width*size.height>32000000)throw Error('Choose a valid screenshot under 32 megapixels.');return {key:P.hash(bytes),asset};
      }
      if(name==='export'){
        await cleanupExport();
        if(!current||dirty||await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)'))throw Error('Save the guide before exporting.');const format=exportRequest(current,args,stateRevision);
        const extension={html:'html',markdown:'md',pdf:'pdf',editable:'mqguide',sanitized:'mqguide'}[format];
        const choice=await dialog.showSaveDialog(host.window,{defaultPath:'Guide.'+extension,filters:[{name:'Guide export',extensions:[extension]}]});if(choice.canceled)return {canceled:true};
        const target=choice.filePath,canonicalParent=await fs.realpath(path.dirname(target));
        for(const root of [...host.protectedRoots,path.join(app.getPath('appData'),'MatiQ Solutions','Guides Bridge')]){let base;try{base=await fs.realpath(root);}catch(error){if(error.code==='ENOENT')continue;throw error;}const relative=path.relative(base,path.join(canonicalParent,path.basename(target)));if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Choose an export destination outside application resources and managed data.');}
        try{const existing=await fs.lstat(target);if(existing.isSymbolicLink()||!existing.isFile())throw Error('Choose a regular destination file, not a symbolic link or directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
        exportUnlock=await P.lock(target);
        try{
        if(format==='editable'||format==='sanitized'){await P.atomicWrite(target,format==='editable'?current:await flattened(true));return {saved:true};}
        const flat=await flattened(),warnings=current.capture?.issues||[];
        if(format==='html'){await P.atomicBytes(target,documentation(flat,warnings));return {saved:true};}
        if(format==='markdown'){
          const assetFolder=path.basename(target)+'.assets',folder=path.join(path.dirname(target),assetFolder);await fs.mkdir(folder,{mode:0o700});
          try{for(const [key,asset] of Object.entries(flat.assets))await fs.writeFile(path.join(folder,key+'.png'),Buffer.from(asset.data,'base64'),{flag:'wx',mode:0o600});await P.atomicBytes(target,markdown(flat,assetFolder,warnings));}catch(error){throw Error('Markdown export did not finish. Choose a new destination and retry. '+error.message);}return {saved:true};
        }
        const output=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.add(output);
        try{output.webContents.setWindowOpenHandler(()=>({action:'deny'}));await output.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(documentation(flat,warnings)));await output.webContents.executeJavaScript('Promise.all(Array.from(document.images,image=>image.decode()))');await P.atomicBytes(target,await output.webContents.printToPDF({printBackground:true,preferCSSPageSize:true}));return {saved:true};}finally{output.destroy();windows.delete(output);}
        }finally{await cleanupExport();}
      }
      throw Error('Unknown Copycat command. Reopen the workspace and retry.');
    }finally{await endWork();}
  });
  const workspaceURL=require('node:url').pathToFileURL(path.join(host.resourceDir,'src/index.html')).href,contents=host.view.webContents;
  const voicePermission=(sender,permission,details)=>!disposing&&!disposed&&sender===contents&&contents.mainFrame.url===workspaceURL&&details.isMainFrame===true&&details.requestingUrl===workspaceURL&&permission==='media'&&desktopAccepting&&narration.status().active;
  contents.session.setPermissionRequestHandler((sender,permission,callback,details)=>callback(voicePermission(sender,permission,details)&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio'));
  contents.session.setPermissionCheckHandler((sender,permission,_origin,details)=>Boolean(voicePermission(sender,permission,details)&&details.mediaType==='audio'));
  await host.view.webContents.loadFile(path.join(host.resourceDir,'src/index.html'));
  async function toolStatus(){if(disposed)return {busy:false};const rendererDirty=await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)');return {busy:updates.busy()||working||narration.status().busy||dirty||rendererDirty||!!activeCapture()||!!exportUnlock||saveState==='failed',reason:updates.busy()?updates.reason():activeCapture()?'Stop or cancel the current capture before closing or restarting.':saveState==='failed'?'Retry the failed save before closing.':narration.status().downloading?'Finish or cancel the local speech model download.':narration.status().busy?'Local narration is being transcribed. Wait for it to finish.':working?'Finish the current Copycat save, dialog or export.':exportUnlock?'Retry export destination cleanup before closing or restarting.':dirty||rendererDirty?'Save the current guide before closing or restarting.':'',background:!!activeCapture()||narration.status().busy};}
  return {
    status:toolStatus,
    async dispose(){
      if(disposed)return;
      if(working)throw Error('Wait for the current save or native dialog to finish, then retry closing Copycat.');
      await cleanupExport();
      disposing=true;
      try{
        await stopDesktop();if(desktopInterrupting)await desktopInterrupting;
        await quiesceBrowser();
        const rendererDirty=await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)');
        if((dirty||rendererDirty)&&current){const draft=P.validate(await host.view.webContents.executeJavaScript('window.guidesDraftSnapshot()'));if(draft.guide.id!==current.guide.id)throw Error('The pending edit identity changed. Keep Copycat open and save a recovered project before retrying closure.');await P.atomicWrite(file+'.draft',draft);}
        if(current?.capture?.phase==='recording')await captureWrite(C.transition(current,'pause',(pendingInterruption?pendingInterruption+' ':'')+'Copycat closed during capture. Reconnect explicitly and review pending steps before continuing.'));
        if(bridge){await bridge.dispose();bridge=null;browserOwner=null;}
        await host.view.webContents.executeJavaScript('window.guidesDispose()');await narration.dispose();for(const win of windows){win.destroy();windows.delete(win);}await updates.dispose();await closeProject();contents.session.setPermissionRequestHandler((_sender,_permission,callback)=>callback(false));contents.session.setPermissionCheckHandler(()=>false);disposed=true;
      }finally{disposing=false;}
    }
  };
};
