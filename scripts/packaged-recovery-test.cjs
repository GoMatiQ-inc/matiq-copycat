const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {once}=require('node:events'),{execFileSync}=require('node:child_process');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const {launchPackagedGuides}=require('./packaged-browser-app.cjs');
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();assert.ok(process.env.RUNNER_TEMP,'Set the retained proof directory before packaged recovery qualification.');
 const root=path.join(__dirname,'..'),temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'guides-recovery-'))),receipts=[];
 let phase='setup',app=null,owned=[],page,child=null,proof,portable=process.env.GUIDES_MIXED_PROJECT;assert.ok(portable,'Supply the retained real captured mixed project for portable recovery qualification.');
 const watchdog=setTimeout(()=>{if(child?.exitCode===null)child.kill('SIGTERM');},240000);
 async function open(suite,profile){phase='open '+(suite?'suite':'standalone');const launched=await launchPackagedGuides({root,profile,suite});app=launched.app;page=launched.editor;child=app.process();owned=captureTree(capture(child));return launched;}
 async function crash(){phase='terminate owned app';
  owned=captureTree(capture(child)).map(row=>({...row,identity:execFileSync('/bin/ps',['-p',String(row.pid),'-o','uid=,lstart=,comm='],{encoding:'utf8'}).trim()}));
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;app=null;child=null;await cleanupDesktop({owned});owned=[];
 }
 async function save(){await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');}
 async function recover(suite,profile,note){
  await open(suite,profile);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  await page.getByRole('button',{name:/Crash recovery fixture/}).click();await page.waitForFunction(note=>document.querySelector('#notes').value===note,note);assert.equal(await page.locator('#save-state').innerText(),'Unsaved');
 }
 try{
  for(const suite of [true,false]){
   const profile=path.join(temporary,suite?'suite':'standalone'),launched=await open(suite,profile);
   phase='import captured mixed project';const incoming=JSON.parse(await fs.readFile(portable,'utf8'));assert.ok(incoming.guide.steps.some(step=>step.kind==='browser')&&incoming.guide.steps.some(step=>step.kind==='desktop'));assert.ok(Object.keys(incoming.assets).length>0);
   await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},portable);await page.getByRole('button',{name:'Import editable project',exact:true}).click();await page.locator('#editor').waitFor({state:'visible'});await page.getByLabel('Guide title',{exact:true}).fill('Crash recovery fixture');await save();
   const file=path.join(launched.library,incoming.guide.id+'.mqguide'),original=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(original.guide.id,incoming.guide.id);assert.ok(JSON.stringify(original.guide.steps)===JSON.stringify(incoming.guide.steps),'Import changed captured ordered steps.');assert.ok(JSON.stringify(original.assets)===JSON.stringify(incoming.assets),'Import changed captured screenshot assets.');
   phase='flush interrupted edit draft';await page.getByLabel('Notes',{exact:true}).fill('Recovered interrupted edit');
   await app.evaluate(({app,dialog})=>{global.guidesRecoveryCloseError='';dialog.showErrorBox=(_title,text)=>{global.guidesRecoveryCloseError=text;};app.quit();});
   for(let i=0;i<100;i++){if(await app.evaluate(()=>global.guidesRecoveryCloseError))break;await new Promise(resolve=>setTimeout(resolve,25));}
   assert.match(await app.evaluate(()=>global.guidesRecoveryCloseError),/unsaved|save.*guide|busy/i);assert.equal(JSON.parse(await fs.readFile(file+'.draft','utf8')).guide.steps[0].notes,'Recovered interrupted edit');
   await crash();assert.ok(JSON.stringify(JSON.parse(await fs.readFile(file,'utf8')))===JSON.stringify(original),'An interrupted edit must preserve the completed save.');
   await recover(suite,profile,'Recovered interrupted edit');await save();const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.guide.id,original.guide.id);assert.equal(saved.guide.steps[0].id,original.guide.steps[0].id);assert.ok(JSON.stringify(saved.assets)===JSON.stringify(original.assets),'Draft recovery changed screenshot assets.');await assert.rejects(fs.access(file+'.draft'),{code:'ENOENT'});
   phase='hold durable pending rename';await page.getByLabel('Notes',{exact:true}).fill('Recovered durable pending save');
   await app.evaluate(({},file)=>{const fs=process.getBuiltinModule('fs/promises'),rename=fs.rename;global.guidesRecoveryRenameHeld=false;fs.rename=async function(from,to){if(from===file+'.pending'&&to===file){global.guidesRecoveryRenameHeld=true;await new Promise(()=>{});}return rename.apply(this,arguments);};},file);
   await page.getByRole('button',{name:'Save',exact:true}).click();
   for(let i=0;i<100;i++){if(await app.evaluate(()=>global.guidesRecoveryRenameHeld))break;await new Promise(resolve=>setTimeout(resolve,25));}
   assert.equal(await app.evaluate(()=>global.guidesRecoveryRenameHeld),true,'Hold only the owned project rename after its real write and fsync.');assert.ok(JSON.stringify(JSON.parse(await fs.readFile(file,'utf8')))===JSON.stringify(saved),'The held rename changed the completed save.');assert.equal(JSON.parse(await fs.readFile(file+'.pending','utf8')).guide.steps[0].notes,'Recovered durable pending save');
   await crash();assert.ok(JSON.stringify(JSON.parse(await fs.readFile(file,'utf8')))===JSON.stringify(saved),'Termination before rename must preserve the previous completed save.');
   await recover(suite,profile,'Recovered durable pending save');await save();const recovered=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(recovered.guide.id,original.guide.id);assert.equal(recovered.guide.steps[0].id,original.guide.steps[0].id);assert.ok(JSON.stringify(recovered.assets)===JSON.stringify(original.assets),'Pending-save recovery changed screenshot assets.');await assert.rejects(fs.access(file+'.pending'),{code:'ENOENT'});
   phase='export recovered mixed project';const exported=path.join(temporary,(suite?'suite':'standalone')+'-recovered.mqguide');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);await page.getByLabel('Export format',{exact:true}).selectOption('editable');await page.getByRole('button',{name:'Export saved guide',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Export saved.'));assert.ok(JSON.stringify(JSON.parse(await fs.readFile(exported,'utf8')))===JSON.stringify(recovered),'Editable export changed recovered guide data.');portable=exported;
   const exited=once(child,'exit');owned=captureTree(capture(child));await app.evaluate(({app})=>{setTimeout(()=>app.quit(),50);});await exited;app=null;child=null;await cleanupDesktop({owned});owned=[];
   receipts.push({form:suite?'suite':'standalone',tool:launched.candidate.version,toolSource:launched.candidate.commit,checks:['actual captured standalone mixed project imports into suite, then recovered suite export imports into standalone with stable ordered steps/assets','unsaved close visibly refused and draft flushed','real app termination and stale ownership recovery','explicit draft recovery restores stable guide/step identities','controlled interruption after real pending write/fsync preserves completed save','explicit pending-save recovery and normal save remove pending files','normal final exit and independent owned cleanup']});
  }
  proof={passed:true,scope:'Real signed packaged crash recovery; only the final owned-file rename is held as a controlled failure fixture.',harnessCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),macOS:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),receipts,cleanupVerified:true};
 }catch(error){console.error('Packaged recovery failed in phase: '+phase);console.error(error.message.slice(0,1000));throw error;}finally{await cleanupDesktop({app,owned,temporary,watchdog});}
 await fs.writeFile(path.join(process.env.RUNNER_TEMP,'matiq-guides-packaged-recovery-proof.json'),JSON.stringify(proof,null,2)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
