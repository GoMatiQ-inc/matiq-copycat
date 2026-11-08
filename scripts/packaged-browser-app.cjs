const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const { _electron:electron }=require('playwright');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
async function launchPackagedGuides({root,profile,openWorkspace=true,suite=!!process.env.GUIDES_SUITE_EXECUTABLE_PATH}){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();
 assert.equal(process.platform,'darwin','Use the authorized Mac for actual packaged browser qualification.');
 const executable=suite?process.env.GUIDES_SUITE_EXECUTABLE_PATH:process.env.GUIDES_EXECUTABLE_PATH,candidate=JSON.parse(await fs.readFile(process.env.GUIDES_CANDIDATE_PROOF,'utf8'));
 assert.equal(candidate.sdk,'0.1.3');assert.equal(candidate.electron,'45.2.3');assert.match(candidate.commit,/^[a-f0-9]{40}$/);assert.ok(executable);
 const contents=path.dirname(path.dirname(executable)),bundle=path.dirname(contents),archive=path.join(contents,'Resources/app.asar'),asar=require('node:module').createRequire(require.resolve('@matiq-solutions/sdk'))('@electron/asar');let record,app;
 try{
  if(suite){
   const publishers=JSON.parse(asar.extractFile(archive,'catalog/trust.json')).publishers,bytes=await fs.readFile(process.env.GUIDES_SUITE_PACKAGE),envelope=JSON.parse(await fs.readFile(process.env.GUIDES_SUITE_PACKAGE+'.release.json')),sdk=require('@matiq-solutions/sdk');assert.ok(sdk.verify(envelope.signed,envelope.signature,publishers[envelope.publisher]));assert.equal(sdk.hash(bytes),envelope.signed.packages['darwin-arm64'].sha256);
   const store=new (require('@matiq-solutions/runtime').ToolStore)({root:path.join(profile,'tool-store'),publishers});record=(await store.state()).tools['com.matiq.guides']||await store.install(bytes,{approveCapabilities:true,expectedId:'com.matiq.guides',expectedVersion:candidate.version,expectedCapabilities:['files','computer']});assert.equal(record.version,candidate.version);assert.equal(record.sha256,sdk.hash(bytes));assert.ok(!record.pending,'Reopen the same qualified package, without a staged test update.');await store.verifyDirectory(record);await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoUpdates:false}));
  }
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{timeout:60000,stdio:'pipe'});execFileSync('/usr/sbin/spctl',['--assess','--type','execute',bundle],{timeout:60000,stdio:'pipe'});
  for(const file of execFileSync('git',['ls-tree','-r','--name-only',candidate.commit,'--','src','matiq-tool.json'],{cwd:root,encoding:'utf8'}).trim().split('\n'))assert.ok((suite?await fs.readFile(path.join(record.directory,file)):asar.extractFile(archive,file)).equals(execFileSync('git',['show',candidate.commit+':'+file],{cwd:root})),'Packaged source differs: '+file);
  app=await electron.launch({executablePath:executable,args:['--user-data-dir='+profile],timeout:20000});const actual=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),profile:app.getPath('userData'),electron:process.versions.electron}));assert.equal(actual.packaged,true);if(!suite)assert.equal(actual.version,candidate.version);assert.equal(actual.electron,candidate.electron);assert.equal(await fs.realpath(actual.profile),profile);
  if(process.env.GUIDES_TEST_OFFLINE==='1')await app.evaluate(({session})=>{for(const partition of [session.defaultSession,session.fromPartition('persist:solutions-com.matiq.guides')])partition.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true}));});
  let editor=await app.firstWindow();editor.setDefaultTimeout(12000);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  if(suite&&openWorkspace){
   await editor.locator('article').filter({has:editor.getByRole('heading',{name:'MatiQ Guides',exact:true})}).getByRole('button',{name:'Open',exact:true}).click();let workspace;
   for(let i=0;i<200;i++){workspace=app.context().pages().find(p=>p.url().includes(record.directory)&&p.url().endsWith('/src/index.html'));if(workspace)break;await new Promise(resolve=>setTimeout(resolve,50));}
   assert.ok(workspace,'The signed suite must load the installed Guides workspace.');editor=workspace;editor.setDefaultTimeout(12000);
  }
  return {app,editor,candidate,suite,suiteVersion:suite?actual.version:undefined,library:path.join(suite?path.join(profile,'tools/com.matiq.guides'):profile,'guides')};
 }catch(error){if(app)await cleanupDesktop({app,owned:captureTree(capture(app.process()))});throw error;}
}
async function installNativeBridge({editor,browser}){
 const identity=require('../extension/identities.json'),parts={chrome:['Google','Chrome'],edge:['Microsoft Edge'],firefox:['Mozilla']}[browser];assert.ok(parts,'Choose a supported real browser.');
 await editor.locator('#bridge-browser').selectOption(browser);await editor.getByRole('button',{name:'Install approved native bridge',exact:true}).click();await editor.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Native bridge registered.'));
 const file=path.join(require('node:os').homedir(),'Library/Application Support',...parts,'NativeMessagingHosts',identity.nativeHost+'.json'),bytes=await fs.readFile(file),manifest=JSON.parse(bytes);
 if(browser==='firefox')assert.deepEqual(manifest.allowed_extensions,[identity.firefoxId]);else assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${identity.chromiumId}/`]);
 execFileSync('/usr/bin/codesign',['--verify','--strict',manifest.path],{timeout:30000,stdio:'pipe'});return {bytes,manifest,file};
}
module.exports={launchPackagedGuides,installNativeBridge};
