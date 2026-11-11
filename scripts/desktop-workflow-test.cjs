const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {capture,captureTree,verifyStopped}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const C=require('../src/capture.cjs'),P=require('../src/project.cjs'),root=path.join(__dirname,'..');
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();assert.equal(process.platform,'darwin');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'copycat-desktop-workflow-'))),program=process.env.GUIDES_WORKFLOW_HELPER||path.join(root,'native/guides-capture');
 const actualApp=process.env.GUIDES_WORKFLOW_APP==='1';let launched,editor,appOwned=[],guideFile,browserVersion,browserChild,browser,browserOwned=[],browserCrashOwned=[];
 let fixture,helper,textedit,textEditPID,fixtureOwned=[],helperOwned=[],project=C.begin(P.create(),'desktop'),proof,failure=null,primary=null;
 const timer=setTimeout(()=>{for(const child of [helper,fixture,launched?.app?.process(),browserChild])if(child?.exitCode===null)child.kill('SIGTERM');},240000);
 function channel(child,label){
  let tail='';const rows=[];child.stdout.on('data',chunk=>{tail+=chunk;let at;while((at=tail.indexOf('\n'))>=0){const row=JSON.parse(tail.slice(0,at));tail=tail.slice(at+1);if(row.type==='title-fixture')console.log('Controlled title fixture: '+JSON.stringify(row));rows.push(row);}});
  return async type=>{for(let i=0;i<300;i++){const error=rows.find(v=>['issue','fixture-error'].includes(v.type));if(error)throw Error(label+': '+error.reason);const at=rows.findIndex(v=>v.type===type);if(at>=0)return rows.splice(at,1)[0];if(child.exitCode!==null)throw Error(label+' exited before '+type);await new Promise(r=>setTimeout(r,50));}throw Error(label+' did not emit '+type);};
 }
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  const permissions=JSON.parse(execFileSync(program,['probe'],{encoding:'utf8',timeout:5000}));assert.ok(permissions.screen&&permissions.accessibility,'Authorize the owned native test context inside Tart; do not qualify denied OS access as successful recording.');
  const binary=require('./native-fixture.cjs').buildNativeFixture({root,temporary});
  fixture=spawn(binary,[],{env:{...process.env,GUIDES_TEST_DESKTOP_WORKFLOW:'1'},stdio:['pipe','pipe','ignore']});fixtureOwned=captureTree(capture(fixture));const nextFixture=channel(fixture,'Fixture');const selected=await nextFixture('ready');
  let nextHelper;
  if(actualApp){
   const profile=path.join(temporary,'profile');
   if(process.env.GUIDES_EXECUTABLE_PATH||process.env.GUIDES_SUITE_EXECUTABLE_PATH)launched=await require('./packaged-browser-app.cjs').launchPackagedGuides({root,profile});
   else{
    const app=await require('playwright')._electron.launch({args:[path.join(root,'test/fixture-main.cjs'),root,profile],timeout:20000});
    editor=await app.firstWindow();editor.setDefaultTimeout(15000);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    launched={app,editor,library:path.join(profile,'guides')};
   }
   editor=launched.editor;appOwned=captureTree(capture(launched.app.process()));
   await editor.locator('#new-record').click();
   await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));
   guideFile=path.join(launched.library,(await fs.readdir(launched.library)).find(f=>f.endsWith('.mqguide')));
   helperOwned=captureTree(capture(launched.app.process())).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8'}).trim())==='guides-capture';}catch{return false;}});
   assert.equal(helperOwned.length,1,'The actual app must own exactly one desktop recorder.');
  }else{
   helper=spawn(program,['record-desktop'],{stdio:['pipe','pipe','ignore']});helperOwned=captureTree(capture(helper));nextHelper=channel(helper,'Recorder');await nextHelper('ready');
   let tail='';helper.stdout.on('data',chunk=>{tail+=chunk;let at;while((at=tail.indexOf('\n'))>=0){const event=JSON.parse(tail.slice(0,at));tail=tail.slice(at+1);if(event.type==='step'){try{project=C.append(project,{...event,id:require('node:crypto').randomUUID(),session:project.capture.id,scope:project.capture.scope,sequence:project.capture.receipts.length}).project;}catch(error){failure=error;}}}});
  }
  async function count(n){for(let i=0;i<200;i++){if(actualApp)project=JSON.parse(await fs.readFile(guideFile,'utf8'));if(failure)throw failure;if(project.guide.steps.length>=n){assert.equal(project.guide.steps.length,n,'No extra or duplicate desktop actions.');console.log('Validated '+n+' actual desktop actions.');return;}await wait(50);}throw Error('Expected '+n+' actual desktop steps; received '+project.guide.steps.length);}
  async function command(value,type){fixture.stdin.write(value+'\n');if(type)await nextFixture(type);}
  await command('click','clicked');await count(1);assert.equal(project.guide.steps[0].instruction,'Click “Open settings”');
  await command('workflow-menu-open','workflow-command');await count(2);await wait(400);
  await command('workflow-menu-dialog','dialog-opened');await count(3);assert.equal(project.guide.steps.at(-1).instruction,'Click “Open dialog”');await wait(400);
  await command('workflow-dialog-close','dialog-closed');await count(4);assert.equal(project.guide.steps.at(-1).instruction,'Click “Confirm dialog”');
  await command('workflow-type','typed');await count(6);assert.equal(project.guide.steps.at(-1).instruction,'Enter the required information in the field');
  await command('workflow-shortcut','shortcut-sent');await count(7);assert.equal(project.guide.steps.at(-1).instruction,'Save');
  await command('workflow-drag','drag-sent');await count(8);assert.match(project.guide.steps.at(-1).instruction,/^Drag /);assert.deepEqual(project.guide.steps.at(-1).annotations.filter(a=>a.type==='callout').map(a=>a.text),['1','2']);
  await command('workflow-right','right-sent');await count(9);assert.match(project.guide.steps.at(-1).instruction,/^Right-click /);
  await command('workflow-escape','escape-sent');await count(10);assert.equal(project.guide.steps.at(-1).instruction,'Press Escape');
  textedit=await require('./textedit-workflow.cjs').openTextEdit({root,temporary});textEditPID=textedit.ready.pid;await wait(400);
  await textedit.command('select','selected');await count(11);await wait(400);
  await textedit.command('bold','clicked');await count(12);assert.ok(['TextEdit','com.apple.TextEdit'].includes(project.guide.steps.at(-1).source.application));
  await textedit.command('save','saved');await count(13);
  assert.ok(/\\b(?:\s|\\)/.test(await fs.readFile(textedit.document,'utf8')),'The actual TextEdit button must change saved formatting.');
  let total=13;const before=project.guide.steps.slice();await textedit.close();textedit=null;
  if(process.env.GUIDES_TEST_CHROMIUM){
   if(actualApp){await editor.locator('#capture-pause').click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'));for(const row of helperOwned)await verifyStopped(row);helperOwned=[];}
   const executable=process.env.GUIDES_TEST_CHROMIUM,bundle=executable.slice(0,executable.indexOf('.app/')+4),profile=path.join(temporary,'browser');
   const crash=require('./browser-crash-fixture.cjs'),baseline=crash.crashHandlers(bundle);
   browserChild=spawn(executable,['--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-updater-scheduler','--disable-sync','about:blank'],{stdio:['ignore','ignore','ignore']});
   browserOwned=captureTree(capture(browserChild));let port;
   for(let i=0;i<200;i++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}if(browserChild.exitCode!==null)throw Error('Owned browser exited before its loopback inspector was ready.');await wait(50);}
   const probe=path.join(temporary,'accessibility-state');execFileSync('xcrun',['swiftc','-module-cache-path',process.env.GUIDES_SWIFT_MODULE_CACHE||path.join(temporary,'modules'),path.join(root,'test/AccessibilityState.swift'),'-o',probe],{timeout:60000,stdio:'pipe'});
   const accessState=()=>JSON.parse(execFileSync(probe,[String(browserChild.pid)],{encoding:'utf8',timeout:10000}));
   const originalAccessibility=accessState();
   if(actualApp){await editor.locator('#desktop-workflow').click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));helperOwned=captureTree(capture(launched.app.process())).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8'}).trim())==='guides-capture';}catch{return false;}});}
   assert.ok(port);browser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+port);browserVersion=browser.version();
   const context=browser.contexts()[0];await context.route(/^https?:/,route=>route.abort());const page=context.pages()[0]||await context.newPage();const file=path.join(temporary,'browser.html');
   await fs.writeFile(file,'<!doctype html><meta charset="utf-8"><title>Controlled desktop browser fixture</title><style>body{padding:60px}button{font:24px sans-serif;padding:20px;background:magenta}</style><button onclick="window.clickCount=(window.clickCount||0)+1;window.clicked=true">Continue desktop workflow</button>');await page.goto(require('node:url').pathToFileURL(file).href);await page.bringToFront();
   execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','Application("System Events").processes.whose({unixId:'+browserChild.pid+'})()[0].frontmost=true;'],{timeout:10000,stdio:'pipe'});await wait(2400);
   const point=await page.getByRole('button',{name:'Continue desktop workflow',exact:true}).evaluate(b=>{const r=b.getBoundingClientRect();return {x:screenX+r.x+r.width/2,y:screenY+outerHeight-innerHeight+r.y+r.height/2};});
   await command('workflow-pointer|'+browserChild.pid+'|'+point.x+'|'+point.y,'pointer-sent');await page.waitForFunction(()=>window.clicked===true);await count(++total);
   assert.match(project.guide.steps.at(-1).source.application,/Chrome|Edge/);assert.equal(project.guide.steps.at(-1).instruction,'Click “Continue desktop workflow”','A normal browser button must expose its real label without forced accessibility launch flags.');
   browserOwned=captureTree(capture(browserChild));browserCrashOwned=crash.captureOwnedCrashHelpers({bundle,baseline,known:browserCrashOwned});
   if(actualApp){await editor.locator('#capture-pause').click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'));for(const row of helperOwned)await verifyStopped(row);helperOwned=[];await wait(2400);assert.deepEqual(accessState(),originalAccessibility,'Recording restores browser accessibility attributes to their original values.');assert.equal(await page.evaluate(()=>window.clickCount),1,'Accessibility activation and cleanup must not replay the browser click.');await editor.locator('#desktop-workflow').click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));helperOwned=captureTree(capture(launched.app.process())).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8'}).trim())==='guides-capture';}catch{return false;}});}
   await cleanupDesktop({app:{process:()=>browserChild,close:()=>browser.close()},owned:[...browserOwned,...browserCrashOwned]});browser=null;browserChild=null;browserOwned=[];browserCrashOwned=[];
  }
  await command('click','clicked');await count(++total);assert.deepEqual(project.guide.steps.slice(0,13),before,'Cross-application capture preserves prior steps.');
  await command('workflow-double','double-sent');await count(++total);assert.equal(project.guide.steps.at(-1).instruction,'Double-click “Open settings”');
  const originBefore=project.guide.steps.length;await command('workflow-scroll');const scrolled=await nextFixture('scrolled');assert.notEqual(scrolled.origin,scrolled.before,'The actual native scroll view must move.');await count(++total);assert.equal(project.guide.steps.at(-1).instruction,'Scroll to the required content');assert.equal(total,originBefore+1);
  await command('workflow-edit-select','edit-selected');await count(total+=2);assert.equal(project.guide.steps.at(-1).instruction,'Select all');
  await command('workflow-copy','copied');await count(++total);assert.equal(project.guide.steps.at(-1).instruction,'Copy');
  fixture.stdin.write('workflow-cut\n');const cut=await nextFixture('cut');assert.equal(cut.empty,true,'Actual Cut must change the selected field.');await count(++total);assert.equal(project.guide.steps.at(-1).instruction,'Cut');
  fixture.stdin.write('workflow-paste\n');const paste=await nextFixture('pasted');assert.equal(paste.restored,true,'Actual Paste must restore the controlled text.');await count(++total);assert.equal(project.guide.steps.at(-1).instruction,'Paste');
  if(actualApp){
   const pid=helperOwned[0].pid;
   const source='var p=Application("System Events").processes.whose({unixId:'+pid+'})()[0];var items=[];for(var b of p.menuBars())items=items.concat(b.menuBarItems());var item=items.find(x=>{try{return String(x.name()).includes("Copycat");}catch{return false;}});if(!item)throw Error("Owned recording menu-bar item is missing.");item.click();delay(.2);item.menus[0].menuItems.byName("Pause recording").click();';
   execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',source],{timeout:10000,stdio:'pipe'});
   await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture paused'));
   for(const row of helperOwned)await verifyStopped(row);helperOwned=[];
   const paused=JSON.parse(await fs.readFile(guideFile,'utf8'));await command('click','clicked');await wait(600);assert.deepEqual(JSON.parse(await fs.readFile(guideFile,'utf8')),paused,'Menu-bar pause must stop actual capture without changing saved work.');
   await editor.locator('#desktop-workflow').click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));
   helperOwned=captureTree(capture(launched.app.process())).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8'}).trim())==='guides-capture';}catch{return false;}});
   assert.equal(helperOwned.length,1);await command('click','clicked');await count(++total);
   await editor.getByRole('button',{name:'Stop capture',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));
   for(const row of helperOwned)await verifyStopped(row);helperOwned=[];
   const preserved=JSON.parse(await fs.readFile(guideFile,'utf8'));
   await editor.locator('#desktop-workflow').click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));
   helperOwned=captureTree(capture(launched.app.process())).filter(row=>{try{return path.basename(execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8'}).trim())==='guides-capture';}catch{return false;}});
   assert.equal(helperOwned.length,1);await command('click','clicked');await count(total+1);
   await editor.getByRole('button',{name:'Cancel capture',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture cancelled'));
   for(const row of helperOwned)await verifyStopped(row);helperOwned=[];
   project=JSON.parse(await fs.readFile(guideFile,'utf8'));assert.deepEqual(project.guide,preserved.guide);assert.deepEqual(project.assets,preserved.assets);
  }else{
   helper.stdin.end('stop\n');await nextHelper('stopped');if(helper.exitCode===null)await once(helper,'exit');
   project=C.transition(project,'stop');
  }const file=path.join(temporary,'guide.mqguide');await P.atomicWrite(file,project);const reopened=await P.read(file);assert.deepEqual(reopened,project);assert.ok(!JSON.stringify(project.guide.steps).includes('CONTROLLED-TYPING-SECRET'));
  await fs.mkdir(path.join(root,'.validation'),{recursive:true});await P.atomicWrite(path.join(root,actualApp?'.validation/desktop-workflow-app-project.mqguide':'.validation/desktop-workflow-component-project.mqguide'),project);
  const oracle=path.join(temporary,'DesktopInspect');execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2','-module-cache-path',process.env.GUIDES_SWIFT_MODULE_CACHE||path.join(temporary,'modules'),path.join(root,'test/DesktopInspect.swift'),'-o',oracle],{timeout:120000,stdio:'pipe'});let pixels;try{pixels=JSON.parse(execFileSync(oracle,[file],{encoding:'utf8',timeout:30000}));}catch(error){throw Error('Desktop screenshot pixel inspection failed: '+String(error.stdout||error.message).trim());}assert.equal(pixels.passed,true);
  if(actualApp){
   await editor.getByLabel('Guide title',{exact:true}).fill('Desktop workflow integration fixture');
   await editor.locator('#steps li button').first().click();
   await editor.getByLabel('Instruction',{exact:true}).fill('Reviewed desktop workflow instruction');
   await editor.getByLabel('Screenshot tool',{exact:true}).selectOption('redact');await editor.getByRole('button',{name:'Apply region',exact:true}).click();
   await editor.getByRole('button',{name:'Save',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
   const edited=await P.read(guideFile);assert.deepEqual(edited.guide.steps.map(s=>s.id),project.guide.steps.map(s=>s.id));assert.deepEqual(edited.assets,project.assets);assert.ok(edited.guide.steps[0].annotations.some(a=>a.type==='redact'));
   const profile=path.join(temporary,'profile'),packaged=!!launched.candidate;
   appOwned=captureTree(capture(launched.app.process()));const exited=once(launched.app.process(),'exit');let quitTimer;
   await launched.app.evaluate(({app})=>{setTimeout(()=>app.quit(),50);});
   try{await Promise.race([exited,new Promise((_,reject)=>{quitTimer=setTimeout(()=>reject(Error('Desktop workflow application did not quit normally.')),10000);})]);}finally{clearTimeout(quitTimer);}
   launched=null;await cleanupDesktop({owned:appOwned});appOwned=[];
   if(packaged)launched=await require('./packaged-browser-app.cjs').launchPackagedGuides({root,profile});
   else{const app=await require('playwright')._electron.launch({args:[path.join(root,'test/fixture-main.cjs'),root,profile],timeout:20000});launched={app,editor:await app.firstWindow(),library:path.join(profile,'guides')};}
   editor=launched.editor;editor.setDefaultTimeout(15000);appOwned=captureTree(capture(launched.app.process()));
   await editor.getByRole('button',{name:/Desktop workflow integration fixture/}).click();await editor.waitForFunction(()=>document.querySelector('#instruction').value==='Reviewed desktop workflow instruction');
   project=await P.read(guideFile);assert.deepEqual(project,edited,'Actual application reopen preserves the edited guide, annotations, identities and original assets.');
   await P.atomicWrite(path.join(root,'.validation/desktop-workflow-app-project.mqguide'),project);
  }
  proof={passed:true,scope:actualApp?(launched.candidate?'Actual signed packaged desktop workflow; application approvals controlled':'SDK desktop integration development only, not signed packaged qualification'):'Development native component only, not signed packaged qualification',form:actualApp?(launched.suite?'suite':'standalone'):'component',packaged:!!launched?.candidate,tool:launched?.candidate?.version,suiteVersion:launched?.suiteVersion,menuBarPauseVerified:actualApp,uiEditRedactExitReopenVerified:actualApp,browserVersion,electron:actualApp?await launched.app.evaluate(()=>process.versions.electron):undefined,runtime:require('@matiq-solutions/runtime/package.json').version,shell:require('@matiq-solutions/shell/package.json').version,browserWindowVerified:!!process.env.GUIDES_TEST_CHROMIUM,source:launched?.candidate?.commit||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),harnessCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),macOS:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),sdk:require('@matiq-solutions/sdk/package.json').version,arch:process.arch,fixturePID:selected.pid,textEditPID,pixels,steps:project.guide.steps.map(s=>({instruction:s.instruction,application:s.source.application,annotations:s.annotations})),checks:['actual menu bar and menu item','actual child sheet and confirmation','typing produces generic wording without raw text','actual Save shortcut','actual Copy, Cut and Paste with verified field changes','typing and paste screenshots contain the resulting field text','actual drag and destination callouts','right click and Escape','actual TextEdit formatting between fixture actions','single session across applications and windows',actualApp?'UI edit and redaction, Save, normal application quit and actual reopen preserve identities, ordering, annotations and assets':'editable file save/reopen preserves steps and assets']};
 }catch(error){primary=error;throw error;}finally{
  if(!proof){await fs.mkdir(path.join(root,'.validation'),{recursive:true});await P.atomicWrite(path.join(root,'.validation/desktop-workflow-component-failed-project.mqguide'),project);}
  const errors=[];for(const [label,operation] of [
   ['TextEdit',()=>textedit?.close()],
   ['Browser',()=>cleanupDesktop({app:browserChild?{process:()=>browserChild,close:()=>browser?.close()}:null,owned:[...browserOwned,...browserCrashOwned]})],
   ['Cancel active app capture',async()=>{if(launched?.app){const state=await launched.editor.evaluate(()=>window.guides.request('state'));if(['recording','paused'].includes(state.project?.capture?.phase))await launched.editor.evaluate(()=>window.guides.request('capture-control','cancel'));}}],
   ['Application',()=>cleanupDesktop({app:launched?.app,owned:appOwned})],
   ['Recorder',()=>cleanupDesktop({app:helper?{process:()=>helper,close:async()=>{if(helper.exitCode===null){const done=once(helper,'exit');helper.stdin.end('stop\n');await done;}}}:null,owned:helperOwned})],
   ['Fixture',()=>cleanupDesktop({app:fixture?{process:()=>fixture,close:async()=>{if(fixture.exitCode===null){const done=once(fixture,'exit');fixture.stdin.end('quit\n');await done;}}}:null,owned:fixtureOwned})]
  ])try{await operation();}catch(error){errors.push(Error(label+': '+error.message));}
  clearTimeout(timer);if(!errors.length)await fs.rm(temporary,{recursive:true,force:true});if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],(primary?'Desktop workflow failed: '+primary.message+'. ':'')+'Inspect every owned desktop-workflow cleanup failure.');
 }
 proof.cleanupVerified=true;await fs.writeFile(path.join(root,actualApp?'.validation/desktop-workflow-app-proof.json':'.validation/desktop-workflow-component-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS: actual desktop workflow across menus, dialogs, gestures and TextEdit; saved/reopened with owned cleanup.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
