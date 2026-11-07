const { _electron:electron }=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs');
const {cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const {execFileSync}=require('node:child_process');
const {once}=require('node:events');
const root=path.join(__dirname,'..');
async function main(){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'matiq-guides-ui-'));let app,owned=[],watchdog;
 const profile=path.join(temporary,'profile');
 async function launch(){
  app=await electron.launch({args:[path.join(root,'test/fixture-main.cjs'),root,profile],env:{...process.env,XDG_CONFIG_HOME:path.join(temporary,'config')},timeout:20000});
  owned=captureTree(capture(app.process()));
  const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>console.error('Renderer error:',e.message));console.log('Workspace URL:',page.url());return page;
 }
 watchdog=setTimeout(()=>{console.error('Guides desktop test timed out; owned cleanup is required.');if(app?.process().exitCode===null)app.process().kill('SIGTERM');},60000);
 try{
  let page=await launch();await require('./invalid-import-fixture.cjs').exerciseInvalidImports(app,page,temporary);await page.getByRole('button',{name:'New guide',exact:true}).click();
  await page.getByLabel('Guide title',{exact:true}).fill('Offline onboarding');
  await page.getByRole('button',{name:'Add manual step',exact:true}).click();
  await page.getByLabel('Instruction',{exact:true}).fill('Open the settings panel');
  await page.getByLabel('Notes',{exact:true}).fill('CONTROLLED-SECRET-NOTE');
  // A controlled image and dialog destination exercise real editor/export code; this is development evidence, not native permission qualification.
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,100,100);return c.toDataURL('image/png').split(',')[1];});
  const image=path.join(temporary,'fixture.png');await fs.writeFile(image,Buffer.from(data,'base64'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},image);
  await page.getByRole('button',{name:'Replace screenshot',exact:true}).click();
  await page.getByLabel('Screenshot tool',{exact:true}).selectOption('redact');
  await page.getByRole('button',{name:'Apply region',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  const guideFile=path.join(profile,'guides',(await fs.readdir(path.join(profile,'guides'))).find(f=>f.endsWith('.mqguide')));
  const saved=JSON.parse(await fs.readFile(guideFile));assert.equal(saved.guide.steps[0].annotations[0].type,'redact');const guideID=saved.guide.id,stepID=saved.guide.steps[0].id;
  const blocked=path.join(temporary,'unreviewed.html');await app.evaluate(({dialog},file)=>{global.fixtureExportDialogs=0;dialog.showSaveDialog=async()=>{global.fixtureExportDialogs++;return {canceled:false,filePath:file};};},blocked);await page.getByLabel('Export format',{exact:true}).selectOption('html');await page.getByRole('button',{name:'Export saved guide',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Review the saved sharing text'));assert.equal(await app.evaluate(()=>global.fixtureExportDialogs),0);await assert.rejects(page.evaluate(()=>window.guides.request('export','html')),/Review the saved sharing text/);await assert.rejects(fs.access(blocked),{code:'ENOENT'});
  await page.getByLabel('Notes',{exact:true}).fill('Reviewed safe note.');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');if(!await page.locator('#sharing-review').evaluate(node=>node.open))await page.locator('#sharing-review summary').click();await page.locator('#sharing-reviewed').check();const reviewed=(await page.evaluate(()=>window.guides.request('state'))).revision;
  await page.getByLabel('Notes',{exact:true}).fill('Reviewed safe note after change.');assert.equal(await page.locator('#sharing-reviewed').isChecked(),false);await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');await assert.rejects(page.evaluate(revision=>window.guides.request('export',{format:'html',reviewedRevision:revision}),reviewed),/Review the saved sharing text/);await page.locator('#sharing-reviewed').check();
  await require('./project-writer-fixture.cjs').exerciseExportOwnership(app,page,path.join(temporary,'owned-destination.mqguide'));
  for(const format of ['html','markdown','pdf','sanitized']){
   const target=path.join(temporary,'export.'+({markdown:'md',sanitized:'mqguide'}[format]||format));
   await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);
   await page.getByLabel('Export format',{exact:true}).selectOption(format);await page.getByRole('button',{name:'Export saved guide',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Export saved.'));
   assert.ok((await fs.stat(target)).size>100);
  }
  for(const name of ['export.html','export.md']){const text=await fs.readFile(path.join(temporary,name),'utf8');assert.ok(!text.includes('CONTROLLED-SECRET-NOTE'),'Read-only export retained text attached to a redacted step.');assert.ok(text.includes('Open the settings panel')&&text.includes('Reviewed safe note after change.')); }
  const sanitized=JSON.parse(await fs.readFile(path.join(temporary,'export.mqguide')));assert.equal(sanitized.guide.id,guideID);assert.equal(sanitized.guide.steps[0].id,stepID);assert.deepEqual(sanitized.guide.steps[0].annotations,[]);assert.equal(sanitized.guide.steps[0].notes,'');assert.notEqual(sanitized.guide.steps[0].asset,saved.guide.steps[0].asset);
  const pixels=await page.evaluate(async project=>{const asset=project.assets[project.guide.steps[0].asset],im=new Image();im.src='data:image/png;base64,'+asset.data;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);return Array.from(x.getImageData(15,15,1,1).data);},sanitized);assert.deepEqual(pixels,[0,0,0,255]);
  assert.ok((await fs.readFile(path.join(temporary,'export.pdf'))).subarray(0,5).toString()==='%PDF-');
  await cleanupDesktop({app,owned});app=null;owned=[];
  page=await launch();await page.getByRole('button',{name:/Offline onboarding/}).click();await page.waitForFunction(()=>document.querySelector('#instruction').value==='Open the settings panel');assert.equal(await page.getByLabel('Instruction',{exact:true}).inputValue(),'Open the settings panel');assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Reviewed safe note after change.');
  assert.equal((await fs.readFile(guideFile,'utf8')).includes(stepID),true);
  await page.getByLabel('Notes',{exact:true}).fill('Recovered interrupted edit');
  await app.evaluate(({app,dialog})=>{global.fixtureCloseError='';dialog.showErrorBox=(_title,detail)=>{global.fixtureCloseError=detail;};app.quit();});
  for(let i=0;i<50;i++){if(await app.evaluate(()=>global.fixtureCloseError))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.match(await app.evaluate(()=>global.fixtureCloseError),/Save the current guide/);
  for(let i=0;i<50;i++){try{await fs.access(guideFile+'.draft');break;}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(JSON.parse(await fs.readFile(guideFile+'.draft')).guide.steps[0].notes,'Recovered interrupted edit');
  owned=captureTree(capture(app.process())).map(row=>({...row,identity:execFileSync('/bin/ps',['-p',String(row.pid),'-o','uid=,lstart=,comm='],{encoding:'utf8'}).trim()}));
  const exited=once(app.process(),'exit');app.process().kill('SIGKILL');await exited;
  await cleanupDesktop({app,owned});app=null;owned=[];
  page=await launch();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  await page.getByRole('button',{name:/Offline onboarding/}).click();await page.waitForFunction(()=>document.querySelector('#notes').value==='Recovered interrupted edit');assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Recovered interrupted edit');
  assert.equal(await page.locator('#save-state').innerText(),'Unsaved');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  await assert.rejects(fs.access(guideFile+'.draft'),{code:'ENOENT'});
  await page.getByRole('button',{name:'All guides',exact:true}).click();const P=require('../src/project.cjs'),C=require('../src/capture.cjs');let boundary=P.create('Warning sharing boundary','D'.repeat(10000));boundary.guide.steps.push(P.step());boundary=C.begin(boundary);boundary=C.warn(boundary,'CONTROLLED-SECRET-WARNING');for(let i=1;i<100;i++)boundary=C.warn(boundary,'Review warning '+i+' '+('x'.repeat(980)));boundary=C.transition(boundary,'stop');const boundaryInput=path.join(temporary,'warning-boundary.mqguide');await P.atomicWrite(boundaryInput,boundary);await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},boundaryInput);await page.getByRole('button',{name:'Import editable project',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#title').value==='Warning sharing boundary');
  await page.getByLabel('Capture warning 1',{exact:true}).fill('Safe reviewed capture warning.');await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await page.getByLabel('Capture warning 1',{exact:true}).inputValue(),'CONTROLLED-SECRET-WARNING');await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await page.getByLabel('Capture warning 1',{exact:true}).inputValue(),'Safe reviewed capture warning.');await page.getByRole('button',{name:'Mark capture warning 2 reviewed and remove',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');if(!await page.locator('#sharing-review').evaluate(node=>node.open))await page.locator('#sharing-review summary').click();assert.ok(!(await page.locator('#sharing-text').innerText()).includes('CONTROLLED-SECRET'));await page.locator('#sharing-reviewed').check();
  for(const format of ['html','sanitized']){const target=path.join(temporary,'boundary.'+(format==='html'?'html':'mqguide'));await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);await page.getByLabel('Export format',{exact:true}).selectOption(format);await page.getByRole('button',{name:'Export saved guide',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Export saved.'));const text=await fs.readFile(target,'utf8');assert.ok(!text.includes('CONTROLLED-SECRET'));assert.ok(text.includes('Review warning 99'));if(format==='sanitized'){const shared=await P.read(target);assert.equal(shared.guide.description.length,10000);assert.equal(shared.guide.steps[0].id,boundary.guide.steps[0].id);assert.ok(shared.guide.steps.length>1);assert.ok(!shared.capture);assert.ok(shared.guide.steps.every(step=>step.timestamp===0));}}
  console.log('PASS: actual SDK standalone workspace creates, illustrates, redacts, saves, exports, reopens, checks sharing review invalidation and long-warning exports, refuses unsaved closure and recovers after an actual owned-process crash. Development execution only.');
 }catch(error){console.error('Journey failed:',error);if(app)for(const p of app.windows())console.error('Window:',p.url(),(await p.locator('body').innerText().catch(()=>'' )).slice(0,1500));throw error;}finally{await cleanupDesktop({app,owned,temporary,watchdog});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
