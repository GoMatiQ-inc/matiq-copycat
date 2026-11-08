const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {capture,captureTree,verifyStopped}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs');
const {cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const {once}=require('node:events');
const root=path.join(__dirname,'..'),suite=!!process.env.GUIDES_SUITE_EXECUTABLE_PATH,executable=process.env.GUIDES_SUITE_EXECUTABLE_PATH||process.env.GUIDES_EXECUTABLE_PATH;
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();
 if(process.platform!=='darwin')throw Error('Run the real native app journey on the authorized Mac.');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'guides-native-app-'))),profile=path.join(temporary,'profile');
 let app,fixture,owned=[],fixtureOwned=[],watchdog,proof,candidate,record,suiteVersion;
 function write(command){fixture.stdin.write(command+'\n');}
 async function runtimeRows(){return captureTree(capture(app.process()));}
 async function nativeRows(){return (await runtimeRows()).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8',timeout:5000}).trim())==='guides-capture';}catch{return false;}});}
 async function closeNormally(){
  owned=await runtimeRows();const exited=once(app.process(),'exit');let timer;
  await app.evaluate(({app})=>{setTimeout(()=>app.quit(),50);});
  try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The native app did not exit after its normal quit request.')),10000);})]);}finally{clearTimeout(timer);}
  app=null;await cleanupDesktop({owned});owned=[];
 }
 async function launch(){
  app=await electron.launch({...(executable?{executablePath:executable,args:['--user-data-dir='+profile]}:{args:[path.join(root,'test/fixture-main.cjs'),root,profile]}),timeout:20000});
  owned=captureTree(capture(app.process()));
  const actual=await app.evaluate(({app})=>({packaged:app.isPackaged,profile:app.getPath('userData'),version:app.getVersion()}));
  assert.equal(actual.packaged,!!executable);assert.equal(await fs.realpath(actual.profile),await fs.realpath(profile),'Use an isolated native app profile.');
  if(suite)suiteVersion=actual.version;else if(executable)assert.equal(actual.version,candidate.version);
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  // Application approval is controlled here; OS permissions and actual capture mechanisms are real.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  if(!suite)return page;
  await page.locator('article').filter({has:page.getByRole('heading',{name:'MatiQ Copycat',exact:true})}).getByRole('button',{name:'Open',exact:true}).click();
  let tool;for(let i=0;i<200;i++){tool=app.context().pages().find(p=>p.url().includes(record.directory)&&p.url().endsWith('/src/index.html'));if(tool)break;await new Promise(resolve=>setTimeout(resolve,50));}
  if(!tool){console.error('Suite workspace diagnostic:',JSON.stringify({expectedDirectory:record.directory,pages:app.context().pages().map(p=>p.url()),contents:await app.evaluate(({webContents})=>webContents.getAllWebContents().map(c=>({type:c.getType(),url:c.getURL()}))),shell:await page.locator('body').innerText()}));}assert.ok(tool,'The actual suite must open the installed isolated Guides workspace.');tool.setDefaultTimeout(15000);return tool;
 }
 watchdog=setTimeout(()=>{if(app?.process().exitCode===null)app.process().kill('SIGTERM');if(fixture?.exitCode===null)fixture.kill('SIGTERM');},180000);
 try{
  if(executable){
   if(!process.env.GUIDES_CANDIDATE_PROOF)throw Error('Supply the verified native candidate receipt alongside the packaged executable.');
   candidate=JSON.parse(await fs.readFile(process.env.GUIDES_CANDIDATE_PROOF,'utf8'));
   assert.equal(candidate.product,'com.matiq.guides');assert.equal(candidate.sdk,'0.1.3');assert.equal(candidate.electron,'45.2.3');assert.match(candidate.commit,/^[a-f0-9]{40}$/);
   const contents=path.dirname(path.dirname(executable)),bundle=path.dirname(contents),archive=path.join(contents,'Resources/app.asar');
   const asar=require('node:module').createRequire(require.resolve('@matiq-solutions/sdk'))('@electron/asar');
   if(suite){
    if(!process.env.GUIDES_SUITE_PACKAGE)throw Error('Supply the real signed Guides package for isolated suite installation.');
    const trust=JSON.parse((await asar.extractFile(archive,'catalog/trust.json')).toString()).publishers;
    const bytes=await fs.readFile(process.env.GUIDES_SUITE_PACKAGE),envelope=JSON.parse(await fs.readFile(process.env.GUIDES_SUITE_PACKAGE+'.release.json','utf8')),sdk=require('@matiq-solutions/sdk');
    assert.ok(sdk.verify(envelope.signed,envelope.signature,trust[envelope.publisher]));assert.equal(sdk.hash(bytes),envelope.signed.packages['darwin-arm64'].sha256);
    const store=new (require('@matiq-solutions/runtime').ToolStore)({root:path.join(profile,'tool-store'),publishers:trust});
    record=await store.install(bytes,{approveCapabilities:true,expectedId:'com.matiq.guides',expectedVersion:candidate.version,expectedCapabilities:['files','computer']});
    await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoUpdates:false}));
   }
   execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{timeout:120000,stdio:'pipe'});
   execFileSync('/usr/sbin/spctl',['--assess','--type','execute',bundle],{timeout:120000,stdio:'pipe'});
   const files=execFileSync('git',['ls-tree','-r','--name-only',candidate.commit,'--','src','matiq-tool.json','package.json','LICENSE','NOTICE','docs','extension/identities.json'],{cwd:root,encoding:'utf8'}).trim().split('\n');
   for(const file of files){const expected=execFileSync('git',['show',candidate.commit+':'+file],{cwd:root});const actual=suite?await fs.readFile(path.join(record.directory,file)):await asar.extractFile(archive,file);if(file==='package.json'){const a=JSON.parse(actual),e=JSON.parse(expected);for(const key of ['name','version','main','license','dependencies'])assert.deepEqual(a[key],e[key],'Packaged runtime metadata differs: '+key);}else assert.ok(actual.equals(expected),'Packaged resource differs from its recorded source: '+file);}
   for(const name of ['sdk','runtime','shell'])assert.equal(JSON.parse((suite?await fs.readFile(path.join(record.directory,'node_modules/@matiq-solutions/'+name+'/package.json')):await asar.extractFile(archive,'node_modules/@matiq-solutions/'+name+'/package.json')).toString()).version,'0.1.3');
  }
  const binary=require('./native-fixture.cjs').buildNativeFixture({root,temporary});
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
  const library=path.join(suite?path.join(profile,'tools/com.matiq.guides'):profile,'guides');
  const guideFile=path.join(library,(await fs.readdir(library)).find(name=>name.endsWith('.mqguide')));
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
  await closeNormally();
  page=await launch();await page.getByRole('button',{name:/Native workflow fixture/}).click();await page.waitForFunction(()=>document.querySelector('#instruction').value==='Open the native settings panel');
  p=await project();assert.equal(p.guide.id,guideID);assert.equal(p.guide.steps[0].id,firstID);assert.ok(p.guide.steps[0].annotations.some(annotation=>annotation.type==='redact'));
  // Explicit window selection is needed again after restarting the app.
  await page.getByRole('button',{name:'Choose desktop window',exact:true}).click();await page.locator('#desktop-window').selectOption(String(selected.window));
  await start();await click();await count(3);
  await page.getByRole('button',{name:'Cancel capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture cancelled'));assert.equal((await project()).guide.steps.length,2);assert.equal((await project()).guide.steps[0].id,firstID);assert.equal((await nativeRows()).length,0);
  if(process.env.GUIDES_PRESSURE_TEST==='1'){
   await start();hooks=await nativeRows();
   await page.evaluate(()=>{window.fixturePendingMaximum=0;window.guides.subscribe(state=>{window.fixturePendingMaximum=Math.max(window.fixturePendingMaximum,state.desktop?.pending||0);});});
   await app.evaluate((_electron,root)=>{
    const P=process.getBuiltinModule('module').createRequire(root+'/package.json')('./src/project.cjs'),original=P.atomicWrite;
    global.fixtureRestoreAtomic=()=>{P.atomicWrite=original;};
    P.atomicWrite=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,1200));return original(...args);};
   },executable?(suite?record.directory:path.join(path.dirname(path.dirname(executable)),'Resources/app.asar')):root);
   try{
    for(let i=0;i<8;i++)await click();
    await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'),null,{timeout:20000});
    p=await project();assert.ok(p.capture.issues.some(reason=>reason.includes('pending delivery reached its limit')));
    assert.ok(p.guide.steps.length>2&&p.guide.steps.length<10,'Only accepted bounded native steps may be retained.');
    assert.equal(p.guide.steps[0].id,firstID);assert.equal(await page.evaluate(()=>window.fixturePendingMaximum),4);
    const state=await page.evaluate(()=>window.guides.request('state'));assert.equal(state.desktop.pending,0);assert.equal(state.desktop.bytes,0);
    for(const hook of hooks)await verifyStopped(hook);
   }finally{await app.evaluate(()=>{global.fixtureRestoreAtomic();delete global.fixtureRestoreAtomic;});}
   await page.getByRole('button',{name:'Stop capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));
  }
  await start();hooks=await nativeRows();write('quit');
  await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'));
  p=await project();assert.ok(p.capture.issues.some(reason=>/closed|screen/i.test(reason)));for(const hook of hooks)await verifyStopped(hook);
  await page.getByRole('button',{name:'Stop capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));
  if(!executable){const status=await app.evaluate(()=>global.fixtureInstance.status());assert.equal(status.busy,false);}
  proof={result:'passed',packaged:!!executable,form:suite?'suite':'standalone',suiteVersion,slowStoragePressure:process.env.GUIDES_PRESSURE_TEST==='1',sourceCommit:candidate?.commit||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),harnessCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),os:os.release(),macOS:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),arch:process.arch,electron:await app.evaluate(()=>process.versions.electron),sdk:require('@matiq-solutions/sdk/package.json').version,checks:['actual SDK adapter receives native selected-window screenshots','pause removes actual helper and captures no actions','explicit resume','stop drains owned helper','edit/redact/save/exit/reopen preserves identities and editable assets','cancel preserves previous steps','application closure visibly pauses','native process absence verified'],qualification:suite?'actual signed packaged suite with real SDK package installation; approval dialogs controlled; public marketplace and fresh permissions separate':executable?'signed packaged standalone execution; application dialogs controlled; fresh OS permissions and suite remain separate gates':'development SDK execution; dialogs controlled; signed installed standalone/suite and fresh permissions unqualified'};
  await closeNormally();
 }catch(error){console.error('Native journey failed:',error.message);throw error;}finally{
  if(app){owned=Array.from(new Map([...owned,...await runtimeRows()].map(row=>[row.pid,row])).values());}
  try{await cleanupDesktop({app,owned});}finally{
   if(fixture&&fixture.exitCode===null){write('quit');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native fixture did not exit.')),5000);fixture.once('exit',()=>{clearTimeout(timer);resolve();});});}
   await cleanupDesktop({owned:fixtureOwned,temporary,watchdog});
  }
 }
 if(proof){proof.ownedProcessCleanup='verified absent';await fs.mkdir(path.join(root,'.validation'),{recursive:true});await fs.writeFile(path.join(root,suite?'.validation/suite-native-app-proof.json':executable?'.validation/packaged-native-app-proof.json':'.validation/native-app-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS: '+(suite?'actual packaged suite':executable?'signed packaged standalone':'development SDK')+' native capture journey; normal app quit and owned process absence verified. Application dialogs controlled.');}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
