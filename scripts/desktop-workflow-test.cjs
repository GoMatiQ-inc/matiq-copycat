const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const C=require('../src/capture.cjs'),P=require('../src/project.cjs'),root=path.join(__dirname,'..');
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();assert.equal(process.platform,'darwin');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'copycat-desktop-workflow-'))),program=process.env.GUIDES_WORKFLOW_HELPER||path.join(root,'native/guides-capture');
 let fixture,helper,textedit,fixtureOwned=[],helperOwned=[],project=C.begin(P.create(),'desktop'),proof,failure=null;
 const timer=setTimeout(()=>{for(const child of [helper,fixture])if(child?.exitCode===null)child.kill('SIGTERM');},120000);
 function channel(child,label){
  let tail='';const rows=[];child.stdout.on('data',chunk=>{tail+=chunk;let at;while((at=tail.indexOf('\n'))>=0){const row=JSON.parse(tail.slice(0,at));tail=tail.slice(at+1);rows.push(row);}});
  return async type=>{for(let i=0;i<300;i++){const error=rows.find(v=>['issue','fixture-error'].includes(v.type));if(error)throw Error(label+': '+error.reason);const at=rows.findIndex(v=>v.type===type);if(at>=0)return rows.splice(at,1)[0];if(child.exitCode!==null)throw Error(label+' exited before '+type);await new Promise(r=>setTimeout(r,50));}throw Error(label+' did not emit '+type);};
 }
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  const permissions=JSON.parse(execFileSync(program,['probe'],{encoding:'utf8',timeout:5000}));assert.ok(permissions.screen&&permissions.accessibility,'Authorize the owned native test context inside Tart; do not qualify denied OS access as successful recording.');
  const binary=require('./native-fixture.cjs').buildNativeFixture({root,temporary});
  fixture=spawn(binary,[],{env:{...process.env,GUIDES_TEST_DESKTOP_WORKFLOW:'1'},stdio:['pipe','pipe','ignore']});fixtureOwned=captureTree(capture(fixture));const nextFixture=channel(fixture,'Fixture');const selected=await nextFixture('ready');
  helper=spawn(program,['record-desktop'],{stdio:['pipe','pipe','ignore']});helperOwned=captureTree(capture(helper));const nextHelper=channel(helper,'Recorder');await nextHelper('ready');
  let tail='';helper.stdout.on('data',chunk=>{tail+=chunk;let at;while((at=tail.indexOf('\n'))>=0){const event=JSON.parse(tail.slice(0,at));tail=tail.slice(at+1);if(event.type==='step'){try{project=C.append(project,{...event,id:require('node:crypto').randomUUID(),session:project.capture.id,scope:project.capture.scope,sequence:project.capture.receipts.length}).project;}catch(error){failure=error;}}}});
  async function count(n){for(let i=0;i<200;i++){if(failure)throw failure;if(project.guide.steps.length>=n){assert.equal(project.guide.steps.length,n,'No extra or duplicate desktop actions.');return;}await wait(50);}throw Error('Expected '+n+' actual desktop steps; received '+project.guide.steps.length);}
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
  textedit=await require('./textedit-workflow.cjs').openTextEdit({root,temporary});await wait(400);
  await textedit.command('select','selected');await count(11);await wait(400);
  await textedit.command('bold','clicked');await count(12);assert.ok(['TextEdit','com.apple.TextEdit'].includes(project.guide.steps.at(-1).source.application));
  await textedit.command('save','saved');await count(13);
  assert.ok(/\\b(?:\s|\\)/.test(await fs.readFile(textedit.document,'utf8')),'The actual TextEdit button must change saved formatting.');
  const before=project.guide.steps.slice();await textedit.close();textedit=null;await command('click','clicked');await count(14);assert.deepEqual(project.guide.steps.slice(0,13),before,'Cross-application capture preserves prior steps.');
  helper.stdin.end('stop\n');await nextHelper('stopped');if(helper.exitCode===null)await once(helper,'exit');
  project=C.transition(project,'stop');const file=path.join(temporary,'guide.mqguide');await P.atomicWrite(file,project);const reopened=await P.read(file);assert.deepEqual(reopened,project);assert.ok(!JSON.stringify(project.guide.steps).includes('CONTROLLED-TYPING-SECRET'));
  await fs.mkdir(path.join(root,'.validation'),{recursive:true});await P.atomicWrite(path.join(root,'.validation/desktop-workflow-component-project.mqguide'),project);
  proof={passed:true,scope:'Development native component only, not signed packaged qualification',source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),macOS:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),sdk:require('@matiq-solutions/sdk/package.json').version,arch:process.arch,fixturePID:selected.pid,textEditPID:textedit?.ready?.pid,steps:project.guide.steps.map(s=>({instruction:s.instruction,application:s.source.application,annotations:s.annotations})),checks:['actual menu bar and menu item','actual child sheet and confirmation','typing produces generic wording without raw text','actual Save shortcut','actual drag and destination callouts','right click and Escape','actual TextEdit formatting between fixture actions','single session across applications and windows','editable save/reopen preserves steps and assets']};
 }finally{
  if(!proof){await fs.mkdir(path.join(root,'.validation'),{recursive:true});await P.atomicWrite(path.join(root,'.validation/desktop-workflow-component-failed-project.mqguide'),project);}
  const errors=[];for(const [label,operation] of [
   ['TextEdit',()=>textedit?.close()],
   ['Recorder',()=>cleanupDesktop({app:helper?{process:()=>helper,close:async()=>{if(helper.exitCode===null){const done=once(helper,'exit');helper.stdin.end('stop\n');await done;}}}:null,owned:helperOwned})],
   ['Fixture',()=>cleanupDesktop({app:fixture?{process:()=>fixture,close:async()=>{if(fixture.exitCode===null){const done=once(fixture,'exit');fixture.stdin.end('quit\n');await done;}}}:null,owned:fixtureOwned})]
  ])try{await operation();}catch(error){errors.push(Error(label+': '+error.message));}
  clearTimeout(timer);if(!errors.length)await fs.rm(temporary,{recursive:true,force:true});if(errors.length)throw new AggregateError(errors,'Inspect every owned desktop-workflow cleanup failure.');
 }
 proof.cleanupVerified=true;await fs.writeFile(path.join(root,'.validation/desktop-workflow-component-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS: actual desktop workflow component across menus, dialogs, gestures and TextEdit; saved/reopened with owned cleanup.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
