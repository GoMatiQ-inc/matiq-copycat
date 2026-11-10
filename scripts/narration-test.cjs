const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();
 const root=path.join(__dirname,'..'),model=process.env.COPYCAT_TEST_MODEL,audio=process.env.COPYCAT_TEST_AUDIO;assert.ok(model&&audio,'Provide the existing verified model and controlled speech WAV.');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'copycat-narration-')));let app,fixture,owned=[],fixtureOwned=[],proof;
 const watchdog=setTimeout(()=>{for(const child of [app?.process(),fixture])if(child?.exitCode===null)child.kill('SIGTERM');},110000);
 try{
  const binary=require('./native-fixture.cjs').buildNativeFixture({root,temporary});fixture=spawn(binary,[],{stdio:['pipe','pipe','ignore']});fixtureOwned=captureTree(capture(fixture));let rows='',ready=false;fixture.stdout.on('data',b=>{rows+=b;if(rows.includes('"type":"ready"'))ready=true;});
  for(let i=0;!ready&&i<200;i++)await new Promise(r=>setTimeout(r,50));assert.ok(ready,'Owned native fixture must start.');
  app=await require('playwright')._electron.launch({args:['--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+audio,path.join(root,'test/narration-main.cjs')],env:{...process.env,COPYCAT_TEST_ROOT:root,COPYCAT_TEST_PROFILE:path.join(temporary,'profile')},timeout:20000});owned=captureTree(capture(app.process()));
  const page=await app.firstWindow();page.setDefaultTimeout(45000);
  await app.evaluate(({dialog,systemPreferences},model)=>{dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[model]});},model);
  assert.equal(await page.evaluate(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());return 'unexpected access';}catch(error){return error.name;}}),'NotAllowedError','The workspace must deny microphone access outside explicit recording.');
  const synthetic=process.env.COPYCAT_TEST_AUDIO_SOURCE==='web-audio-fixture';
  if(synthetic)await page.evaluate(async bytes=>{
   window.fixtureOriginalGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext({sampleRate:16000,sinkId:{type:'none'}}),source=context.createBufferSource(),destination=context.createMediaStreamDestination();source.buffer=await context.decodeAudioData(new Uint8Array(bytes).buffer);source.loop=true;source.connect(destination);await context.resume();source.start();window.fixtureSpeech={context,source,stream:destination.stream};return destination.stream;};
  },Array.from(await fs.readFile(audio)));
  await page.locator('#voice').check();await page.locator('#new-record').click();await page.waitForFunction(()=>document.querySelector('#voice-status').textContent.includes('Microphone recording'));
  await new Promise(r=>setTimeout(r,4500));fixture.stdin.write('click\n');
  await page.waitForFunction(()=>document.querySelector('#instruction').value==='Click “Open settings”');
  owned=captureTree(capture(app.process()));await page.getByRole('button',{name:'Stop capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture stopped'));
  assert.match(await page.locator('#instruction').inputValue(),/settings panel.*save button/is);
  const directory=path.join(temporary,'profile'),guideFile=(await fs.readdir(path.join(directory,'guides'))).find(f=>f.endsWith('.mqguide')),project=JSON.parse(await fs.readFile(path.join(directory,'guides',guideFile),'utf8'));
  assert.match(project.guide.steps[0].instruction,/settings panel.*save button/is);assert.deepEqual(await fs.readdir(path.join(directory,'narration')),[],'Successful narration must remove retained audio.');
  if(synthetic){assert.equal(await page.evaluate(()=>window.fixtureSpeech.stream.getAudioTracks()[0].readyState),'ended','Stop must actually end the owned audio track.');await page.evaluate(()=>window.fixtureSpeech.context.close());}
  const preserved=project.guide;await page.locator('#desktop-workflow').click();await page.waitForFunction(()=>document.querySelector('#voice-status').textContent.includes('Microphone recording'));await new Promise(r=>setTimeout(r,1500));fixture.stdin.write('click\n');await page.waitForFunction(()=>document.querySelector('#steps').children.length===2);
  await page.getByRole('button',{name:'Cancel capture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('capture cancelled'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'guides',guideFile),'utf8')).guide,preserved);assert.deepEqual(await fs.readdir(path.join(directory,'narration')),[]);
  if(synthetic){assert.equal(await page.evaluate(()=>window.fixtureSpeech.stream.getAudioTracks()[0].readyState),'ended');await page.evaluate(()=>window.fixtureSpeech.context.close());assert.equal(await page.evaluate(async()=>{try{const stream=await window.fixtureOriginalGetUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());return 'unexpected access';}catch(error){return error.name;}}),'NotAllowedError');}
  proof={result:'passed',input:synthetic?'controlled synthetic MediaStream, real AudioWorklet and whisper.cpp inference; getUserMedia fixture replacement':'controlled Chromium virtual microphone, real AudioWorklet and whisper.cpp inference',physicalMicrophone:'not qualified',steps:project.guide.steps.length,audioDeleted:true,cancelRestoresGuide:true,inactiveMicrophoneDenied:true};
 }finally{
  if(app)await cleanupDesktop({app,owned:[...owned,...captureTree(capture(app.process()))]});
  if(fixture?.exitCode===null){fixture.stdin.end('quit\n');await new Promise(resolve=>{fixture.once('exit',resolve);setTimeout(()=>{if(fixture.exitCode===null)fixture.kill('SIGTERM');},2000).unref();});}
  await cleanupDesktop({owned:fixtureOwned,temporary,watchdog});
 }
 console.log(JSON.stringify({...proof,ownedCleanup:'verified'}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
