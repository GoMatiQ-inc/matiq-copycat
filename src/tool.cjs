const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {dialog, BrowserWindow, nativeImage} = require('electron');
const P = require('./project.cjs');
const {documentation, markdown} = require('./export.cjs');
exports.activate = async host => {
  const library=path.join(host.dataDir,'guides');await fs.mkdir(library,{recursive:true,mode:0o700});
  let current=null,file=null,release=null,dirty=false,working=false,saveState='saved',failure='',disposed=false;
  const windows=new Set();
  const snapshot=()=>({project:current,file:file?path.basename(file):null,saveState,error:failure});
  async function idle(){if(dirty)throw Error('Save your guide before switching or closing it.');}
  async function closeProject(){if(release){await release();release=null;}current=null;file=null;dirty=false;}
  async function open(target) {
    await idle();if(target===file)return snapshot();const unlock=await P.lock(target);
    try {
      let loaded=await P.read(target),recovered=false;
      try {
        await fs.access(target+'.pending');
        const choice=await dialog.showMessageBox(host.window,{type:'warning',message:'An interrupted save is available.',detail:'Recover the pending project, or keep the last completed save. The existing saved project remains intact until you save.',buttons:['Recover pending save','Keep last save','Cancel'],cancelId:2,defaultId:0});
        if(choice.response===2){await unlock();return snapshot();}
        if(choice.response===0){loaded=await P.read(target+'.pending');recovered=true;}else await fs.unlink(target+'.pending');
      }catch(error){if(error.code!=='ENOENT')throw error;}
      await closeProject();current=loaded;file=target;release=unlock;dirty=recovered;saveState=dirty?'unsaved':'saved';failure='';return snapshot();
    }catch(error){await unlock();throw error;}
  }
  async function save(){if(!current)throw Error('Open or create a guide first.');saveState='saving';failure='';try{await P.atomicWrite(file,current);dirty=false;saveState='saved';}catch(error){saveState='failed';failure='Saving failed. Keep this guide open and retry: '+error.message;throw Error(failure);}return snapshot();}
  async function flattened(sanitized=false) {
    const result=P.clone(current);result.assets={};
    for(let i=0;i<result.guide.steps.length;i++){
      const s=result.guide.steps[i],original=current.guide.steps[i];
      if(s.asset){
        const source=current.assets[s.asset];
        const data=await host.view.webContents.executeJavaScript(`window.guidesRender(${JSON.stringify({step:original,asset:source})})`);
        if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw Error('Screenshot rendering failed. Reopen the guide before exporting.');
        s.asset=P.addImage(result,Buffer.from(data.slice(22),'base64'));s.annotations=[];s.crop=null;
      }
      s.source=null;
      if(sanitized){s.notes='';if(original.annotations.some(a=>a.type==='redact'))s.instruction=`Step ${i+1} — review this instruction before sharing`;}
    }
    return P.compact(result);
  }
  host.handle('com.matiq.guides:request',async(name,args)=>{
    if(disposed)throw Error('Reopen Guides before continuing.');
    if(name==='state')return snapshot();
    if(name==='dirty'){dirty=true;saveState='unsaved';return;}
    if(working)throw Error('Wait for the current operation to finish.');working=true;
    try {
      if(name==='list'){
        const names=(await fs.readdir(library)).filter(n=>n.endsWith('.mqguide'));const rows=[];
        for(const n of names){try{const p=await P.read(path.join(library,n));rows.push({id:p.guide.id,title:p.guide.title,description:p.guide.description,steps:p.guide.steps.length});}catch{rows.push({id:n.slice(0,-8),title:'Unreadable guide — import a recovered copy',description:'This project failed validation. Its original file has been preserved.',steps:0,invalid:true});}}return rows;
      }
      if(name==='new'){
        if(dirty)throw Error('Save the current guide before creating another.');const project=P.create();const target=path.join(library,project.guide.id+'.mqguide');const unlock=await P.lock(target);
        try{await P.atomicWrite(target,project);await closeProject();current=project;file=target;release=unlock;saveState='saved';return snapshot();}catch(error){await unlock();throw error;}
      }
      if(name==='open'){
        if(typeof args!=='string'||!/^[a-f0-9-]{36}$/.test(args))throw Error('Select a valid guide from the library.');
        return await open(path.join(library,args+'.mqguide'));
      }
      if(name==='import'){
        if(dirty)throw Error('Save the current guide before importing another.');const choice=await dialog.showOpenDialog(host.window,{properties:['openFile'],filters:[{name:'Editable MatiQ guide',extensions:['mqguide']}]});
        if(choice.canceled)return snapshot();const project=await P.read(choice.filePaths[0]);
        const target=path.join(library,project.guide.id+'.mqguide');
        try{await fs.access(target);throw Error('This guide already exists in the library. Duplicate it explicitly before importing another copy.');}catch(error){if(error.code!=='ENOENT')throw error;}
        const unlock=await P.lock(target);
        try{await P.atomicWrite(target,project);await closeProject();current=project;file=target;release=unlock;saveState='saved';return snapshot();}catch(error){await unlock();throw error;}
      }
      if(name==='save'){
        if(!current)throw Error('Open a guide first.');const checked=P.validate(args);if(checked.guide.id!==current.guide.id)throw Error('Guide ownership changed. Reopen before saving.');current=checked;dirty=true;return await save();
      }
      if(name==='duplicate'){
        if(!current||dirty)throw Error('Save the guide before duplicating it.');const copy=P.clone(current);copy.guide.id=randomUUID();copy.guide.title+=' (copy)';await P.atomicWrite(path.join(library,copy.guide.id+'.mqguide'),copy);return snapshot();
      }
      if(name==='delete'){
        if(!current||dirty)throw Error('Save the current guide before deleting it.');const answer=await dialog.showMessageBox(host.window,{type:'warning',message:'Delete this local guide?',detail:'This permanently removes this library copy and its embedded screenshots. Portable exports are separate files.',buttons:['Keep guide','Delete guide'],cancelId:0,defaultId:0});if(answer.response===1){await fs.unlink(file);try{await fs.unlink(file+'.pending');}catch(e){if(e.code!=='ENOENT')throw e;}await closeProject();}return snapshot();
      }
      if(name==='image'){
        const choice=await dialog.showOpenDialog(host.window,{properties:['openFile'],filters:[{name:'Screenshot',extensions:['png','jpg','jpeg']}]});if(choice.canceled)return null;
        const stat=await fs.stat(choice.filePaths[0]);if(stat.size>16*1024*1024)throw Error('Choose a screenshot under 16 MiB.');const bytes=await fs.readFile(choice.filePaths[0]),asset=P.image(bytes),decoded=nativeImage.createFromBuffer(bytes),size=decoded.getSize();
        if(decoded.isEmpty()||size.width*size.height>32000000)throw Error('Choose a valid screenshot under 32 megapixels.');return {key:P.hash(bytes),asset};
      }
      if(name==='export'){
        if(!current||dirty)throw Error('Save the guide before exporting.');if(!['html','markdown','pdf','editable','sanitized'].includes(args))throw Error('Choose a supported export format.');
        const extension={html:'html',markdown:'md',pdf:'pdf',editable:'mqguide',sanitized:'mqguide'}[args];
        const choice=await dialog.showSaveDialog(host.window,{defaultPath:'Guide.'+extension,filters:[{name:'Guide export',extensions:[extension]}]});if(choice.canceled)return {canceled:true};
        const target=choice.filePath;
        if(args==='editable'||args==='sanitized'){await P.atomicWrite(target,args==='editable'?current:await flattened(true));return {saved:true};}
        const flat=await flattened();
        if(args==='html'){await fs.writeFile(target,documentation(flat),{mode:0o600});return {saved:true};}
        if(args==='markdown'){
          const assetFolder=path.basename(target)+'.assets',folder=path.join(path.dirname(target),assetFolder);await fs.mkdir(folder,{mode:0o700});
          try{for(const [key,asset] of Object.entries(flat.assets))await fs.writeFile(path.join(folder,key+'.png'),Buffer.from(asset.data,'base64'),{flag:'wx',mode:0o600});await fs.writeFile(target,markdown(flat,assetFolder),{mode:0o600});}catch(error){throw Error('Markdown export did not finish. Choose a new destination and retry. '+error.message);}return {saved:true};
        }
        const output=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.add(output);
        try{output.webContents.setWindowOpenHandler(()=>({action:'deny'}));await output.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(documentation(flat)));await output.webContents.executeJavaScript('Promise.all(Array.from(document.images,image=>image.decode()))');await fs.writeFile(target,await output.webContents.printToPDF({printBackground:true,preferCSSPageSize:true}),{mode:0o600});return {saved:true};}finally{output.destroy();windows.delete(output);}
      }
      throw Error('Unknown Guides command. Reopen the workspace and retry.');
    }finally{working=false;}
  });
  await host.view.webContents.loadFile(path.join(host.resourceDir,'src/index.html'));
  return {
    async status(){const rendererDirty=await host.view.webContents.executeJavaScript('Boolean(window.guidesDirty)');return {busy:working||dirty||rendererDirty,reason:working?'Finish the current Guides save, dialog or export.':dirty||rendererDirty?'Save the current guide before closing or restarting.':'',background:false};},
    async dispose(){if(working||dirty)throw Error('Finish saving or exporting before closing Guides.');for(const win of windows){win.destroy();windows.delete(win);}await closeProject();disposed=true;}
  };
};
