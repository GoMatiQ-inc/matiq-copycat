// Browser-only design data. No native capture, file access or OS permissions.
const setupSteps=[{"id":"storage","title":"Your guides stay on this Mac","body":"Guides, screenshots, edits and exports are stored locally. No account or model download is needed. Imports and sharing happen only when you choose.","kind":"review","label":"I reviewed local storage and sharing."},{"id":"capture","title":"Review capture scope","body":"Desktop recording follows your explicit Start and Stop actions. A selected-window scope and manual guide editing are also available.","kind":"choice","label":"Default capture mode","options":[["desktop","Desktop workflow across apps"],["window","One selected application window"]]},{"id":"screen","title":"Allow Screen Recording","body":"Enable Screen Recording for {app}. This permits screenshots during your recording; setup itself does not record your desktop.","kind":"check","permission":true,"action":"Check Screen Recording","success":"Screen Recording access verified.","help":"In System Settings \u2192 Privacy & Security, enable {app}. If macOS requests a restart, quit and reopen {app}, then check again. Setup resumes here."},{"id":"accessibility","title":"Allow Accessibility","body":"Enable Accessibility for {app} so Copycat can identify controls and describe workflow actions. Normal typed characters are not stored as instructions.","kind":"check","permission":true,"action":"Check Accessibility","success":"Accessibility access verified.","help":"In System Settings \u2192 Privacy & Security, enable {app}. If macOS requests a restart, quit and reopen {app}, then check again. Setup resumes here."},{"id":"privacy","title":"Review screenshots before sharing","body":"Screenshots can contain private information. Review, crop and redact each guide before exporting. Automatic masking cannot guarantee that every secret is hidden.","kind":"review","label":"I understand that I must review screenshots and instructions before sharing."},{"id":"browser","title":"Optional browser extensions","body":"Desktop recording works without an extension. You may skip this. Choosing a browser registers its local connector; install and enable the separate extension in that browser before using browser capture.","kind":"choice","label":"Browser extension","options":[["none","Skip extensions"],["chrome","Prepare Chrome connector"],["edge","Prepare Edge connector"],["firefox","Prepare Firefox connector"]]},{"id":"updates","title":"Review updates and quitting","body":"{app} owns updates for this installed tool. Quitting during a recording asks whether to stop and save. A failed save keeps the app open.","kind":"review","label":"I reviewed update ownership and safe shutdown."},{"id":"ready","title":"Ready to use Copycat","body":"Required setup is finished. You can revisit settings later; recording still requires your explicit Start.","kind":"summary"}];
let setupState={schema:1,completed:false,step:0,values:{}};
function setupRequest(value){
 if(value.command==='state')return {...structuredClone(setupState),steps:setupSteps,applicationName:(new URLSearchParams(location.search).get('mode')==='standalone'?'MatiQ Copycat':'MatiQ Solutions')};
 if(value.command==='review')setupState.values[value.id]=value.value;
 else if(value.command==='check')setupState.values[value.id]='verified';
 else if(value.command==='progress')setupState.step=value.step;
 else if(value.command==='reopen'){setupState.completed=false;setupState.step=0;}
 else if(value.command==='complete'){
  if(setupSteps.slice(0,-1).some(step=>!setupState.values[step.id]))throw Error('Complete the prototype setup sections.');
  setupState.completed=true;
 }
 return structuredClone(setupState);
}

let previewProject=null;const listeners=[];
const snapshot=()=>({setup:structuredClone(setupState),revision:0,project:previewProject,saveState:'saved',unsaved:false,error:'',updates:{enabled:false},desktop:{active:false},bridge:null});
window.guides={subscribe:callback=>{listeners.push(callback);return ()=>{};},request:async(name,args)=>{
 if(name==='setup'){const result=setupRequest(args);window.matiqPrototypeSetupReady=result.completed;return result;}
 if(name==='state')return snapshot();if(name==='list')return [];
 if(!window.matiqPrototypeSetupReady)throw Error('Finish Copycat setup before using this tool.');
 if(name==='new'){previewProject={format:'matiq-guides',version:1,guide:{id:crypto.randomUUID(),title:'Untitled guide',description:'',steps:[]},assets:{}};return snapshot();}
 if(name==='save'){previewProject=structuredClone(args);return snapshot();}
 if(name==='dirty'||name==='draft')return {saved:true};
 throw Error('Prototype only: '+name+' does not access your files, browser, or desktop.');
}};
