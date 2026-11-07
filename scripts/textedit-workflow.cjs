const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {capture,captureTree,verifyStopped}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const identity=pid=>{try{return execFileSync('/bin/ps',['-p',String(pid),'-o','uid=,lstart=,comm='],{encoding:'utf8',timeout:5000}).trim()||null;}catch(error){if(error.status===1)return null;throw error;}};
async function openTextEdit({root,temporary}){
 assert.equal(process.platform,'darwin','Use the authorized Mac for the actual TextEdit workflow.');
 const binary=path.join(temporary,'TextEditDriver'),document=path.join(temporary,'Guides-Controlled-Note.rtf');
 const initial='{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs28 Controlled onboarding note\\par Review setup before sharing.\\par}';
 await fs.writeFile(document,initial,{flag:'wx'});
 execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2','-module-cache-path',process.env.GUIDES_SWIFT_MODULE_CACHE||path.join(temporary,'modules'),path.join(root,'test/TextEditDriver.swift'),'-o',binary],{timeout:120000,stdio:'pipe'});
 const driver=spawn(binary,[document],{stdio:['pipe','pipe','pipe']}),driverOwned=captureTree(capture(driver)),messages=[];let target=null,tail='',failure='',stderr='',timer,closing=false;
 driver.stdout.on('data',part=>{tail+=part.toString();let i;while((i=tail.indexOf('\n'))>=0){let message;try{message=JSON.parse(tail.slice(0,i));}catch{failure='The owned TextEdit driver emitted malformed output.';driver.kill('SIGTERM');return;}tail=tail.slice(i+1);if(message.type==='owned'){target={pid:message.pid,ports:[],identity:identity(message.pid)};if(!target.identity?.endsWith('/System/Applications/TextEdit.app/Contents/MacOS/TextEdit'))failure='The newly launched TextEdit process identity could not be verified.';}if(message.type==='error')failure=message.reason;messages.push(message);}});
 driver.stderr.on('data',part=>{stderr=(stderr+part.toString()).slice(-2000);});driver.stdin.on('error',error=>{if(!closing)failure='The owned native driver input closed: '+error.message;});
 async function next(type){const end=Date.now()+15000;while(Date.now()<end){if(failure)throw Error(failure);const message=messages.shift();if(message?.type===type)return message;if(driver.exitCode!==null)throw Error('The owned TextEdit driver exited before '+type+(stderr?' (native diagnostic retained by the owned fixture)':''));await new Promise(resolve=>setTimeout(resolve,50));}throw Error('The controlled TextEdit workflow did not report '+type);}
 async function command(value,type){driver.stdin.write(value+'\n');return next(type);}
 async function close(){
  closing=true;clearTimeout(timer);const errors=[];
  try{if(target){const current=identity(target.pid);assert.ok(current===null||current===target.identity,'TextEdit PID ownership changed; leave the unknown process untouched.');const wrapper=current?{process:()=>({pid:target.pid,exitCode:null,signalCode:null}),close:async()=>{if(driver.exitCode===null)driver.stdin.end('stop\n');}}:null;await cleanupDesktop({app:wrapper,owned:[target]});}}catch(error){errors.push(error);}
  try{await cleanupDesktop({app:{process:()=>driver,close:async()=>{if(driver.exitCode===null){const exited=once(driver,'exit');driver.stdin.end('stop\n');await exited;}}},owned:driverOwned});}catch(error){errors.push(error);}
  for(const stream of [driver.stdin,driver.stdout,driver.stderr])stream.destroy();
  if(errors.length)throw new AggregateError(errors,'Owned TextEdit workflow cleanup failed. Inspect the retained fixture and exact process identities.');
 }
 timer=setTimeout(()=>{if(driver.exitCode===null)driver.kill('SIGTERM');if(target&&identity(target.pid)===target.identity)process.kill(target.pid,'SIGTERM');},60000);
 try{const ready=await next('ready');assert.equal(ready.pid,target?.pid);return {ready,command,document,initial,close};}catch(error){await close();throw error;}
}
async function captureTextEditWorkflow({app,editor,file,root,temporary}){
 const before=JSON.parse(await fs.readFile(file,'utf8')),session=await openTextEdit({root,temporary});let proof;
 try{
  await session.command('select','selected');await editor.getByRole('button',{name:'Choose desktop window',exact:true}).click();await editor.locator('#desktop-window').selectOption(String(session.ready.window));
  await editor.getByRole('button',{name:'Start / resume selected window',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));
  const hooks=captureTree(capture(app.process())).filter(row=>identity(row.pid)?.endsWith('/guides-capture'));assert.equal(hooks.length,1,'The actual signed helper must observe the selected TextEdit window.');
  const click=await session.command('bold','clicked');assert.equal(click.window,session.ready.window);
  await editor.waitForFunction(n=>document.querySelectorAll('#steps li').length===n,before.guide.steps.length+1);
  await session.command('save','saved');const formatted=await fs.readFile(session.document,'utf8');assert.ok(/\\b(?:\s|\\)/.test(formatted),'The real TextEdit document must contain bold formatting after the actual button click and save.');
  await new Promise(resolve=>setTimeout(resolve,300));await editor.getByRole('button',{name:'Stop capture',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));for(const row of hooks)await verifyStopped(row);
  const project=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(project.guide.steps.length,before.guide.steps.length+1,'Keyboard save must not become a captured step.');assert.deepEqual(project.guide.steps.slice(0,before.guide.steps.length),before.guide.steps,'Appending native capture must preserve browser steps.');
  const step=project.guide.steps.at(-1);assert.equal(step.kind,'desktop');assert.ok(['TextEdit','com.apple.TextEdit'].includes(step.source.application),'Retain the real TextEdit name or OS bundle identity.');assert.ok(project.assets[step.asset]);assert.ok(project.guide.steps.some(step=>step.kind==='browser'));assert.ok(step.annotations.some(a=>a.type==='box'));
  await editor.locator('#steps li button').last().click();await editor.getByLabel('Instruction',{exact:true}).fill('Make the selected text bold in TextEdit');await editor.getByRole('button',{name:'Save',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  const edited=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(edited.guide.steps.at(-1).id,step.id);assert.equal(edited.guide.steps.at(-1).instruction,'Make the selected text bold in TextEdit');
  const image=await editor.evaluate(async input=>window.guidesRender(input),{step:edited.guide.steps.at(-1),asset:edited.assets[step.asset]});proof={application:'TextEdit',applicationVersion:execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString','/System/Applications/TextEdit.app/Contents/Info.plist'],{encoding:'utf8'}).trim(),browserSteps:before.guide.steps.length,nativeSteps:1,guideID:edited.guide.id,stepID:step.id,checks:['new TextEdit instance and owned rich-text document','real Bold button changes saved document formatting','selected signed native capture appends screenshot/target to existing browser guide','keyboard Save adds no recorded typing or step','earlier browser steps unchanged','native instruction edit preserves identity','stopped native helper independently absent'],illustration:Buffer.from(image.split(',')[1],'base64')};
 }finally{await session.close();}
 return proof;
}
module.exports={openTextEdit,captureTextEditWorkflow};
