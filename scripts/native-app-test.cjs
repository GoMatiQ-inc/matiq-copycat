const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {capture,captureTree,verifyStopped}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs');
const {cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const root=path.join(__dirname,'..');
async function main(){
 if(process.platform!=='darwin')throw Error('Run the real native app journey on the authorized Mac.');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'guides-native-app-')),profile=path.join(temporary,'profile');
 let app,fixture,owned=[],fixtureOwned=[],watchdog,proof;
 function write(command){fixture.stdin.write(command+'\n');}
 async function runtimeRows(){return captureTree(capture(app.process()));}
 async function nativeRows(){return (await runtimeRows()).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8',timeout:5000}).trim())==='guides-capture';}catch{return false;}});}
 async function launch(){
  app=await electron.launch({args:[path.join(root,'test/fixture-main.cjs'),root,profile],timeout:20000});
  owned=captureTree(capture(app.process()));
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  // Application approval is controlled here; OS permissions and actual capture mechanisms are real.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  return page;
 }
 watchdog=setTimeout(()=>{if(app?.process().exitCode===null)app.process().kill('SIGTERM');if(fixture?.exitCode===null)fixture.kill('SIGTERM');},180000);
 try{
  const binary=path.join(temporary,'GuidesNativeFixture'),cache=path.join(temporary,'modules');
  execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2','-module-cache-path',cache,path.join(root,'test/CaptureFixture.swift'),'-o',binary],{timeout:120000,stdio:'pipe'});
  fixture=spawn(binary,[],{stdio:['pipe','pipe','ignore']});fixtureOwned=captureTree(capture(fixture));
  const messages=[],waiting=[];let tail='';
  fixture.stdout.on('data',chunk=>{tail+=chunk.toString();let i;while((i=tail.indexOf('\n'))>=0){const line=tail.slice(0,i);tail=tail.slice(i+1);const value=JSON.parse(line);if(waiting.length)waiting.shift()(value);else messages.push(value);}});
  async function next(kind){const end=Date.now()+10000;while(Date.now()<end){const value=messages.length?messages.shift():await new Promise((resolve,reject)=>{let listener;const timer=setTimeout(()=>{const i=waiting.indexOf(listener);if(i>=0)waiting.splice(i,1);reject(Error('Controlled native fixture did not emit '+kind));},Math.max(1,end-Date.now()));listener=v=>{clearTimeout(timer);resolve(v);};waiting.push(listener);});if(value.type===kind)return value;}throw Error('Controlled native fixture did not emit '+kind);}
  const selected=await next('ready');let page=await launch();
  await page.getByRole('button',{name:'New guide',exact:true}).click();
  await page.getByLabel('Guide title',{exact:true}).fill('Native workflow fixture');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  await page.getByRole('button',{name:'Choose desktop window',exact:true}).click();
  await page.locator('#desktop-window').selectOption(String(selected.window));
  const guideFile=path.join(profile,'guides',(await fs.readdir(path.join(profile,'guides'))).find(name=>name.endsWith('.mqguide')));
  async function project(){return JSON.parse(await fs.readFile(guideFile,'utf8'));}
  async function count(expected){await page.waitForFunction(n=>document.querySelectorAll('#steps li').length===n,expected);}
  async function start(){await page.getByRole('button',{name:'Start / resume selected window',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));assert.equal((await nativeRows()).length,1,'Exactly one owned native recorder must be active.');}
  async function click(){write('click');const sent=await next('click-sent');assert.ok(sent.focused,'The controlled app must own foreground focus.');await next('clicked');}
  await start();await click();await count(1);
  let p=await project();assert.equal(p.guide.steps[0].kind,'desktop');assert.equal(p.guide.steps[0].instruction,'Click “Open settings”');assert.ok(p.assets[p.guide.steps[0].asset]);assert.ok(!JSON.stringify(p.guide.steps).includes('CONTROLLED-SECRET'));
  const firstID=p.guide.steps[0].id,guideID=p.guide.id;let hooks=await nativeRows();
  await page.getByRole('button',{name:'Pause capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'));for(const hook of hooks)await verifyStopped(hook);
  await click();await new Promise(resolve=>setTimeout(resolve,400));assert.equal((await project()).guide.steps.length,1,'Paused capture added a step.');
  await start();await click();await count(2);hooks=await nativeRows();
  await page.getByRole('button',{name:'Stop capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));for(const hook of hooks)await verifyStopped(hook);
  await page.getByLabel('Instruction',{exact:true}).fill('Open the native settings panel');
  await page.getByLabel('Screenshot tool',{exact:true}).selectOption('redact');await page.getByRole('button',{name:'Apply region',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  owned=await runtimeRows();await cleanupDesktop({app,owned});app=null;owned=[];
  page=await launch();await page.getByRole('button',{name:/Native workflow fixture/}).click();await page.waitForFunction(()=>document.querySelector('#instruction').value==='Open the native settings panel');
  p=await project();assert.equal(p.guide.id,guideID);assert.equal(p.guide.steps[0].id,firstID);assert.ok(p.guide.steps[0].annotations.some(annotation=>annotation.type==='redact'));
  // Explicit window selection is needed again after restarting the app.
  await page.getByRole('button',{name:'Choose desktop window',exact:true}).click();await page.locator('#desktop-window').selectOption(String(selected.window));
  await start();await click();await count(3);
  await page.getByRole('button',{name:'Cancel capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture cancelled'));assert.equal((await project()).guide.steps.length,2);assert.equal((await project()).guide.steps[0].id,firstID);assert.equal((await nativeRows()).length,0);
  await start();hooks=await nativeRows();write('quit');
  await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'));
  p=await project();assert.ok(p.capture.issues.some(reason=>/closed|screen/i.test(reason)));for(const hook of hooks)await verifyStopped(hook);
  await page.getByRole('button',{name:'Stop capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));
  const status=await app.evaluate(()=>global.fixtureInstance.status());assert.equal(status.busy,false);
  proof={result:'passed',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),os:os.release(),macOS:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),arch:process.arch,electron:await app.evaluate(()=>process.versions.electron),sdk:require('@matiq-solutions/sdk/package.json').version,checks:['actual SDK adapter receives native selected-window screenshots','pause removes actual helper and captures no actions','explicit resume','stop drains owned helper','edit/redact/save/exit/reopen preserves identities and editable assets','cancel preserves previous steps','application closure visibly pauses','native process absence verified'],qualification:'development SDK execution; dialogs controlled; signed installed standalone/suite and fresh permissions unqualified'};
 }finally{
  if(app){owned=Array.from(new Map([...owned,...await runtimeRows()].map(row=>[row.pid,row])).values());}
  try{await cleanupDesktop({app,owned});}finally{
   if(fixture&&fixture.exitCode===null){write('quit');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native fixture did not exit.')),5000);fixture.once('exit',()=>{clearTimeout(timer);resolve();});});}
   await cleanupDesktop({owned:fixtureOwned,temporary,watchdog});
  }
 }
 if(proof){proof.ownedProcessCleanup='verified absent';await fs.mkdir(path.join(root,'.validation'),{recursive:true});await fs.writeFile(path.join(root,'.validation/native-app-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS: actual macOS SDK/native capture journey; component and app-owned processes independently absent. Development execution only.');}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
