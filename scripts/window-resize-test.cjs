const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {launchPackagedGuides}=require('./packaged-browser-app.cjs'),{capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const root=path.join(__dirname,'..');
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();assert.equal(process.env.GUIDES_TEST_WINDOW_RESIZE,'1','Enable the controlled painted-button resize fixture.');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'copycat-window-resize-')));let fixture,launched,owned=[],fixtureOwned=[],proof;
 const watchdog=setTimeout(()=>{for(const child of [fixture,launched?.app?.process()])if(child?.exitCode===null)child.kill('SIGTERM');},120000);
 const events=[];let tail='';const write=command=>fixture.stdin.write(command+'\n');
 async function next(type){for(let i=0;i<200;i++){const at=events.findIndex(e=>e.type===type);if(at>=0)return events.splice(at,1)[0];await new Promise(r=>setTimeout(r,50));}throw Error('The actual resize fixture did not emit '+type);}
 try{
  const binary=require('./native-fixture.cjs').buildNativeFixture({root,temporary});fixture=spawn(binary,[],{stdio:['pipe','pipe','ignore']});fixtureOwned=captureTree(capture(fixture));fixture.stdout.on('data',chunk=>{tail+=chunk;let at;while((at=tail.indexOf('\n'))>=0){events.push(JSON.parse(tail.slice(0,at)));tail=tail.slice(at+1);}});
  const selected=await next('ready');launched=await launchPackagedGuides({root,profile:path.join(temporary,'profile')});const {app,editor}=launched;owned=captureTree(capture(app.process()));
  await editor.getByRole('button',{name:'New guide',exact:true}).click();await editor.getByRole('button',{name:'Choose desktop window',exact:true}).click();await editor.locator('#desktop-window').selectOption(String(selected.window));await editor.getByRole('button',{name:'Start / resume selected window',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture recording'));
  const file=path.join(launched.library,(await fs.readdir(launched.library)).find(f=>f.endsWith('.mqguide'))),project=async()=>JSON.parse(await fs.readFile(file,'utf8'));
  async function click(){write('click');assert.ok((await next('click-sent')).focused);await next('clicked');}
  async function measurement(p){
   const step=p.guide.steps.at(-1),asset=p.assets[step.asset],box=step.annotations.find(a=>a.type==='box');assert.ok(box,'The painted native button needs a target box.');
   const paint=await app.evaluate(({nativeImage},asset)=>{const image=nativeImage.createFromBuffer(Buffer.from(asset.data,'base64')),size=image.getSize(),pixels=image.toBitmap();let left=size.width,top=size.height,right=-1,bottom=-1;
    for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){const i=(y*size.width+x)*4;if(pixels[i]>180&&pixels[i+1]<100&&pixels[i+2]>180){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
    if(right<left)throw Error('The actual screenshot has no painted target.');return {x:left/size.width,y:top/size.height,width:(right-left+1)/size.width,height:(bottom-top+1)/size.height};
   },asset);const delta=Math.max(Math.abs(paint.x+paint.width/2-box.x-box.width/2),Math.abs(paint.y+paint.height/2-box.y-box.height/2)),contained=box.x>=paint.x-.005&&box.y>=paint.y-.005&&box.x+box.width<=paint.x+paint.width+.005&&box.y+box.height<=paint.y+paint.height+.005;return {paint,box,delta,contained};
  }
  await click();await editor.waitForFunction(()=>document.querySelectorAll('#steps li').length===1);const baselineProject=await project(),baseline=await measurement(baselineProject);await fs.mkdir(path.join(root,'.validation'),{recursive:true});await fs.writeFile(path.join(root,'.validation/window-resize-baseline.json'),JSON.stringify(baseline,null,2)+'\n');await fs.writeFile(path.join(root,'.validation/window-resize-baseline.jpg'),Buffer.from(baselineProject.assets[baselineProject.guide.steps[0].asset].data,'base64'));assert.ok(baseline.delta<.01&&baseline.contained,'Calibrate the independent painted-target oracle on a stable actual screenshot.');const results=[];
  for(let attempt=0;attempt<3;attempt++){
   const before=await project();write('resize-next');await next('resize-armed');await click();
   await editor.waitForFunction(n=>document.querySelector('#capture-status').textContent.includes('capture paused')||document.querySelectorAll('#steps li').length>n,before.guide.steps.length);const p=await project();await next('resize-restored');
   if(p.capture.phase==='paused'){assert.deepEqual(p.guide,before.guide);assert.deepEqual(p.assets,before.assets);assert.ok(p.capture.issues.some(s=>/window.*chang|screenshot/i.test(s)));results.push({attempt,result:'visible-review-pause'});break;}
   const observed=await measurement(p);results.push({attempt,result:'captured',...observed});if(observed.delta>=.02||!observed.contained){await fs.writeFile(path.join(root,'.validation/window-resize-failure.jpg'),Buffer.from(p.assets[p.guide.steps.at(-1).asset].data,'base64'));await fs.mkdir(path.join(root,'.validation'),{recursive:true});await fs.writeFile(path.join(root,'.validation/window-resize-failure.json'),JSON.stringify({baseline,results,tool:launched.candidate.version,source:launched.candidate.commit,harness:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},null,2)+'\n');throw Error('Actual resized-window screenshot target is misaligned; delta='+observed.delta.toFixed(4));}
  }
  await editor.getByRole('button',{name:'Stop capture',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));proof={passed:true,tool:launched.candidate.version,source:launched.candidate.commit,form:launched.suite?'suite':'standalone',baseline,results,limits:'Actual temporary painted-button fixture, real OS resize and signed packaged capture; application approval dialogs controlled.'};
 }finally{
  const errors=[];async function clean(label,operation){try{await operation();}catch(error){console.error(label+': '+error.message);errors.push(error);}}
  await clean('Cancel owned capture',async()=>{if(launched?.app){const state=await launched.editor.evaluate(()=>window.guides.request('state'));if(['recording','paused'].includes(state.project?.capture?.phase))await launched.editor.evaluate(()=>window.guides.request('capture-control','cancel'));}});
  await clean('Packaged application cleanup',()=>cleanupDesktop({app:launched?.app,owned}));
  await clean('Native fixture quit',async()=>{if(fixture?.exitCode===null){const exited=once(fixture,'exit');write('quit');await exited;}});
  await clean('Independent native fixture cleanup',()=>cleanupDesktop({owned:fixtureOwned,temporary,watchdog}));
  if(errors.length)throw new AggregateError(errors,'Inspect every owned resize-fixture cleanup error.');
 }

 if(proof){proof.cleanupVerified=true;await fs.writeFile(path.join(root,'.validation/window-resize-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS: actual native resized-window capture is aligned or visibly paused, with owned cleanup.');}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
