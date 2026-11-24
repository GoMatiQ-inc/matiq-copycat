const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
test('Copycat confirmed Quit drains a pending captured step and saves; failed final save remains retryable',{timeout:10000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'copycat-quit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const toolFile=path.join(__dirname,'../src/tool.cjs'),load=createRequire(toolFile),module={exports:{}};
 let request,deliver,stopped=false,release,held,hold=true,failStop=false;
 const P=load('./project.cjs'),atomic=P.atomicWrite;
 const project={...P,atomicWrite:async(file,value)=>{
  if(value.capture?.receipts.length&&value.capture.phase==='recording'&&hold){hold=false;held?.();await new Promise(resolve=>{release=resolve;});}
  if(failStop&&value.capture?.phase==='stopped')throw Error('Controlled disk failure');
  return atomic(file,value);
 }};
 const desktop={permissions:async()=>({screen:true,accessibility:true}),start:async(_host,_id,_pid,onEvent)=>{deliver=onEvent;return {stop:async()=>{stopped=true;}};}};
 const electron={app:{getName:()=> 'MatiQ Solutions'},dialog:{showMessageBox:async()=>({response:1})},BrowserWindow:class{},nativeImage:{}};
 vm.runInNewContext('(function(require,module,exports){'+await fs.readFile(toolFile,'utf8')+'\n})',{Buffer,queueMicrotask,setTimeout,clearTimeout})(name=>name==='electron'?electron:name==='./project.cjs'?project:name==='./desktop.cjs'?desktop:name==='./standalone-updates.cjs'?{create:()=>({snapshot:()=>({}),busy:()=>false,dispose:async()=>{}})}:load(name),module,module.exports);
 const host={dataDir:root,resourceDir:path.join(__dirname,'..'),emit:()=>{},handle:(_name,fn)=>{request=fn;},view:{webContents:{loadFile:async()=>{},executeJavaScript:async()=>false}}};
 const tool=await module.exports.activate(host);
 for(const step of require('../src/setup-steps.json'))if(step.kind!=='summary')await request('setup',step.kind==='check'?{command:'check',id:step.id}:{command:'review',id:step.id,value:step.kind==='review'?'reviewed':step.id==='browser'?'none':'desktop'});
 await request('setup',{command:'complete'});await request('new');await request('desktop-workflow');
 assert.equal((await tool.status()).recording,true);
 const heldWrite=new Promise(resolve=>{held=resolve;});
 deliver({at:Date.now(),source:'desktop',application:'Owned synthetic fixture',action:'click',control:'button',label:'Settings',image:{mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII='}});
 await heldWrite;let finished=false;const saving=tool.stopAndSave().then(()=>{finished=true;});
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(stopped,true);assert.equal(finished,false,'Quit must await queued capture persistence.');
 release();await saving;assert.equal((await tool.status()).recording,false);
 let state=await request('state');assert.equal(state.project.capture.phase,'stopped');assert.equal(state.project.guide.steps.length,1);
 const files=await fs.readdir(path.join(root,'guides')),file=path.join(root,'guides',files.find(name=>name.endsWith('.mqguide')));
 const saved=JSON.parse(await fs.readFile(file));assert.equal(saved.guide.steps.length,1);assert.equal(saved.capture.phase,'stopped');
 await request('desktop-workflow');failStop=true;
 await assert.rejects(tool.stopAndSave(),/Controlled disk failure/);assert.equal((await tool.status()).recording,true);
 failStop=false;await tool.stopAndSave();assert.equal((await tool.status()).recording,false);assert.equal(JSON.parse(await fs.readFile(file)).guide.steps.length,1);
 await tool.dispose();assert.equal((await tool.status()).busy,false);
});
