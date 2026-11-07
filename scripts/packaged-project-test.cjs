const {_electron:electron,chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync,spawn}=require('node:child_process'),{once}=require('node:events'),{pathToFileURL}=require('node:url');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs');
const {cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
const root=path.join(__dirname,'..'),{crashHandlers,captureOwnedCrashHelpers}=require('./browser-crash-fixture.cjs'),browserBundle='/Applications/Google Chrome.app';
async function main(){
 if(process.platform!=='darwin')throw Error('Run packaged cross-form qualification on the authorized Mac.');
 const candidate=JSON.parse(await fs.readFile(process.env.GUIDES_CANDIDATE_PROOF,'utf8'));
 assert.equal(candidate.sdk,'0.1.3');assert.equal(candidate.electron,'45.2.3');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'guides-portable-'))),output=path.join(temporary,'exports');await fs.mkdir(output);
 const asar=require('node:module').createRequire(require.resolve('@matiq-solutions/sdk'))('@electron/asar');
 let app,owned=[],browser,server,browserOwned=[],crashBaseline=[],crashOwned=[],watchdog,proof;
 const forms=[],documentationSets=[];
 async function close(){
  owned=captureTree(capture(app.process()));const exited=once(app.process(),'exit');let timer;
  await app.evaluate(({app})=>{setTimeout(()=>app.quit(),50);});
  try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Packaged app refused normal exit; inspect saved work and busy state.')),10000);})]);}finally{clearTimeout(timer);}
  await cleanupDesktop({app,owned});app=null;owned=[];
 }
 async function launch(suite,label){
  const profile=path.join(temporary,label);await fs.mkdir(profile);
  const executable=suite?process.env.GUIDES_SUITE_EXECUTABLE_PATH:process.env.GUIDES_EXECUTABLE_PATH;
  if(!executable)throw Error('Supply both actual installed packaged executable paths.');
  const contents=path.dirname(path.dirname(executable)),archive=path.join(contents,'Resources/app.asar');let record;
  if(suite){
   const publishers=JSON.parse(asar.extractFile(archive,'catalog/trust.json')).publishers;
   const bytes=await fs.readFile(process.env.GUIDES_SUITE_PACKAGE),envelope=JSON.parse(await fs.readFile(process.env.GUIDES_SUITE_PACKAGE+'.release.json'));
   const sdk=require('@matiq-solutions/sdk');assert.ok(sdk.verify(envelope.signed,envelope.signature,publishers[envelope.publisher]));assert.equal(sdk.hash(bytes),envelope.signed.packages['darwin-arm64'].sha256);
   record=await new (require('@matiq-solutions/runtime').ToolStore)({root:path.join(profile,'tool-store'),publishers}).install(bytes,{approveCapabilities:true,expectedId:'com.matiq.guides',expectedVersion:candidate.version,expectedCapabilities:['files','computer']});
   await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoUpdates:false}));
  }
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',path.dirname(contents)],{timeout:120000,stdio:'pipe'});
  execFileSync('/usr/sbin/spctl',['--assess','--type','execute',path.dirname(contents)],{timeout:120000,stdio:'pipe'});
  for(const file of execFileSync('git',['ls-tree','-r','--name-only',candidate.commit,'--','src','matiq-tool.json'],{cwd:root,encoding:'utf8'}).trim().split('\n')){
   const actual=suite?await fs.readFile(path.join(record.directory,file)):asar.extractFile(archive,file);
   assert.ok(actual.equals(execFileSync('git',['show',candidate.commit+':'+file],{cwd:root})),'Packaged source differs: '+file);
  }
  app=await electron.launch({executablePath:executable,args:['--user-data-dir='+profile],timeout:20000});owned=captureTree(capture(app.process()));
  const actual=await app.evaluate(({app,session})=>{
   // Make network unavailable in this owned test profile, including suite catalog refreshes.
   session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
   return {packaged:app.isPackaged,profile:app.getPath('userData'),version:app.getVersion(),electron:process.versions.electron};
  });
  assert.equal(actual.packaged,true);assert.equal(await fs.realpath(actual.profile),profile);assert.equal(actual.electron,'45.2.3');if(!suite)assert.equal(actual.version,candidate.version);
  forms.push({form:suite?'suite':'standalone',version:actual.version,dataDir:suite?'profile/tools/com.matiq.guides/guides':'profile/guides'});
  let page=await app.firstWindow();page.setDefaultTimeout(15000);
  if(suite){
   await page.locator('article').filter({has:page.getByRole('heading',{name:'MatiQ Guides',exact:true})}).getByRole('button',{name:'Open',exact:true}).click();
   for(let i=0;i<200;i++){const found=app.context().pages().find(p=>p.url().includes(record.directory)&&p.url().endsWith('/src/index.html'));if(found){page=found;break;}await new Promise(r=>setTimeout(r,50));}
   assert.ok(page.url().includes(record.directory));
   await app.evaluate(({session})=>{session.fromPartition('persist:solutions-com.matiq.guides').webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));});
  }
  page.setDefaultTimeout(15000);
  if(process.env.GUIDES_TEST_SAFE_DIAGNOSTICS==='1'){
   const invalid=path.join(temporary,label+'-invalid.mqguide');await fs.writeFile(invalid,'CONTROLLED-SECRET-PROJECT-CONTENT');let diagnostics='';const collect=part=>{diagnostics=(diagnostics+part.toString()).slice(-10000);};app.process().stderr.on('data',collect);
   try{await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},invalid);await page.getByRole('button',{name:'Import editable project',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('invalid JSON'));assert.match(await page.locator('#message').innerText(),/Restore a verified project copy/);assert.ok(!(await page.locator('#message').innerText()).includes('CONTROLLED-SECRET'));assert.equal((await page.evaluate(()=>window.guides.request('state'))).project,null);assert.ok(!diagnostics.includes('CONTROLLED-SECRET'),'Malformed import contents must not appear in Electron diagnostics.');}finally{app.process().stderr.off('data',collect);}
  }
  return page;
 }
 async function inspectPDF(reader,file,preview){
  const child=spawn(reader,[file,preview],{stdio:['ignore','pipe','pipe']}),rows=captureTree(capture(child));let output='',errors='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),45000);child.stdout.on('data',part=>{output+=part.toString();if(Buffer.byteLength(output)>1024*1024)child.kill('SIGKILL');});child.stderr.on('data',part=>{errors=(errors+part.toString()).slice(-2000);});
  try{const [code,signal]=await once(child,'exit');assert.equal(code,0,'Independent PDF inspector failed or exceeded 45 seconds: '+(signal||errors));return JSON.parse(output);}finally{clearTimeout(timer);await cleanupDesktop({owned:rows});}
 }
 async function save(page){await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');}
 async function exportFile(page,format,name){const target=path.join(output,name);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);await page.getByLabel('Export format',{exact:true}).selectOption(format);await page.getByRole('button',{name:'Export saved guide',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Export saved.'));assert.ok((await fs.stat(target)).size>100);return target;}
 async function reviewSharingText(page,firstNote){
  await page.locator('#steps li button').nth(0).click();await page.getByLabel('Notes',{exact:true}).fill(firstNote);await page.locator('#steps li button').nth(1).click();await page.getByLabel('Notes',{exact:true}).fill('Safe second instruction note.');await save(page);await page.locator('#steps li button').nth(0).click();if(!await page.locator('#sharing-review').evaluate(node=>node.open))await page.locator('#sharing-review summary').click();assert.ok(!(await page.locator('#sharing-text').innerText()).includes('CONTROLLED-SECRET'));await page.locator('#sharing-reviewed').check();
 }
 async function importFile(page,file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.getByRole('button',{name:'Import editable project',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#title').value==='Portable onboarding');}
 async function region(page,type,rect,text=''){await page.getByLabel('Screenshot tool',{exact:true}).selectOption(type);for(const [key,value]of Object.entries(rect))await page.locator('#'+key).fill(String(value));await page.getByLabel('Annotation text or number',{exact:true}).fill(text);await page.getByRole('button',{name:'Apply region',exact:true}).click();}
 watchdog=setTimeout(()=>{for(const child of [app?.process(),server?.process()])if(child?.exitCode===null)child.kill('SIGTERM');},180000);
 try{
  let page=await launch(false,'standalone-first');await page.getByRole('button',{name:'New guide',exact:true}).click();await page.getByLabel('Guide title',{exact:true}).fill('Portable onboarding');await page.getByLabel('Description',{exact:true}).fill('Review the illustrated setup steps.');
  await page.getByRole('button',{name:'Add manual step',exact:true}).click();await page.getByLabel('Instruction',{exact:true}).fill('Open settings');await page.getByLabel('Notes',{exact:true}).fill('CONTROLLED-SECRET-NOTE');
  const image=path.join(temporary,'controlled.png'),data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,800,500);x.fillStyle='#d00';x.fillRect(80,50,240,100);x.fillStyle='#000';x.font='22px sans-serif';x.fillText('CONTROLLED-SECRET',90,90);x.fillText('Settings panel',400,300);return c.toDataURL('image/png').split(',')[1];});await fs.writeFile(image,Buffer.from(data,'base64'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},image);await page.getByRole('button',{name:'Replace screenshot',exact:true}).click();
  for(const [type,rect,text]of [['box',{x:55,y:50,width:30,height:15},''],['arrow',{x:50,y:35,width:20,height:10},''],['text',{x:55,y:75,width:30,height:10},'Settings'],['callout',{x:85,y:45,width:8,height:10},'1']])await region(page,type,rect,text);
  await region(page,'redact',{x:10,y:10,width:40,height:20});await region(page,'crop',{x:5,y:5,width:90,height:90});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();
  await page.getByRole('button',{name:'Duplicate step',exact:true}).click();await page.getByLabel('Instruction',{exact:true}).fill('Confirm settings');await page.getByRole('button',{name:'Move up',exact:true}).click();await page.getByRole('button',{name:'Duplicate step',exact:true}).click();await page.getByRole('button',{name:'Delete step',exact:true}).click();await page.getByRole('button',{name:'Add manual step',exact:true}).click();await page.getByLabel('Instruction',{exact:true}).fill('Finish setup');await page.getByLabel('Notes',{exact:true}).fill('Keep this safe note.');await save(page);
  const outbound=await exportFile(page,'editable','standalone.mqguide'),original=JSON.parse(await fs.readFile(outbound));assert.equal(original.guide.steps.length,3);assert.equal(original.guide.steps[0].instruction,'Confirm settings');assert.equal(original.guide.steps[0].annotations.length,5);assert.ok(original.guide.steps[0].crop);assert.equal(Object.keys(original.assets).length,1);
  const blocked=path.join(output,'unreviewed.html');await app.evaluate(({dialog},file)=>{global.fixtureExportDialogs=0;dialog.showSaveDialog=async()=>{global.fixtureExportDialogs++;return {canceled:false,filePath:file};};},blocked);await page.getByLabel('Export format',{exact:true}).selectOption('html');await page.getByRole('button',{name:'Export saved guide',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Review the saved sharing text'));assert.equal(await app.evaluate(()=>global.fixtureExportDialogs),0);await assert.rejects(page.evaluate(()=>window.guides.request('export','html')),/Review the saved sharing text/);await assert.rejects(fs.access(blocked),{code:'ENOENT'});await reviewSharingText(page,'Reviewed in standalone');
  documentationSets.push({form:'standalone',html:await exportFile(page,'html','standalone.html'),md:await exportFile(page,'markdown','standalone.md'),pdf:await exportFile(page,'pdf','standalone.pdf')});
  await close();page=await launch(true,'suite');await importFile(page,outbound);await reviewSharingText(page,'Reviewed in the suite');
  const returned=await exportFile(page,'editable','suite.mqguide'),suiteProject=JSON.parse(await fs.readFile(returned));
  assert.equal(suiteProject.guide.id,original.guide.id);assert.deepEqual(suiteProject.guide.steps.map(s=>s.id),original.guide.steps.map(s=>s.id));assert.deepEqual(suiteProject.assets,original.assets);assert.deepEqual(suiteProject.guide.steps[0].annotations,original.guide.steps[0].annotations);assert.deepEqual(suiteProject.guide.steps[0].crop,original.guide.steps[0].crop);
  const html=await exportFile(page,'html','guide.html'),md=await exportFile(page,'markdown','guide.md'),pdf=await exportFile(page,'pdf','guide.pdf'),sanitized=await exportFile(page,'sanitized','sharing.mqguide');
  documentationSets.push({form:'suite',html,md,pdf});
  const flat=JSON.parse(await fs.readFile(sanitized));assert.equal(flat.guide.id,original.guide.id);assert.deepEqual(flat.guide.steps.map(s=>s.id),original.guide.steps.map(s=>s.id));assert.ok(!JSON.stringify(flat).includes('CONTROLLED-SECRET'));assert.ok(!JSON.stringify(flat).includes('Reviewed in the suite'));assert.ok(flat.guide.steps.every(s=>!s.annotations.length&&!s.crop&&!s.source&&!s.notes&&s.timestamp===0));assert.ok(!flat.capture);for(const key of Object.keys(original.assets))assert.ok(!flat.assets[key],'Sharing export retained an original screenshot.');
  await close();page=await launch(false,'standalone-return');await importFile(page,returned);await page.waitForFunction(()=>document.querySelector('#notes').value==='Reviewed in the suite');const finalFile=await exportFile(page,'editable','roundtrip.mqguide');assert.deepEqual(JSON.parse(await fs.readFile(finalFile)),suiteProject);await close();
  crashBaseline=crashHandlers(browserBundle);server=await chromium.launchServer({args:['--disable-updater-scheduler'],executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',host:'127.0.0.1',port:0,headless:true});browserOwned=captureTree(capture(server.process()));crashOwned=captureOwnedCrashHelpers({bundle:browserBundle,baseline:crashBaseline});browser=await chromium.connect(server.wsEndpoint());const inspect=await browser.newPage();const pdfReader=path.join(temporary,'PDFInspect');execFileSync('xcrun',['swiftc','-module-cache-path',path.join(temporary,'modules'),path.join(root,'test/PDFInspect.swift'),'-o',pdfReader],{timeout:120000,stdio:'pipe'});let pdfPages=0;for(const {html,md,pdf}of documentationSets){await inspect.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort():route.continue());await inspect.goto(pathToFileURL(html).href);assert.equal(await inspect.locator('section').count(),3);assert.equal(await inspect.locator('h1').innerText(),'Portable onboarding');assert.equal(await inspect.locator('h2').last().innerText(),'3. Finish setup');assert.ok((await inspect.locator('body').innerText()).includes('Keep this safe note.'));assert.ok(!(await inspect.locator('body').innerText()).includes('CONTROLLED-SECRET'));assert.equal(await inspect.locator('h2').first().innerText(),'1. Confirm settings');
  const pixels=await inspect.locator('img').first().evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {width:c.width,height:c.height,pixel:Array.from(x.getImageData(80,45,1,1).data)};});assert.deepEqual(pixels,{width:720,height:450,pixel:[0,0,0,255]});
  const htmlImage=Buffer.from((await inspect.locator('img').first().getAttribute('src')).split(',')[1],'base64');assert.ok(!(await fs.readFile(html,'utf8')).includes(Object.values(original.assets)[0].data),'HTML retained an unredacted original.');
  const markdown=await fs.readFile(md,'utf8');assert.ok(!markdown.includes('CONTROLLED-SECRET'));assert.ok(markdown.includes('Finish setup')&&markdown.includes('Keep this safe note.'));const refs=[...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m=>decodeURIComponent(m[1]));assert.equal(refs.length,2);for(const ref of refs){assert.ok(!path.isAbsolute(ref)&&!ref.split('/').includes('..'));const asset=await fs.readFile(path.join(output,ref));assert.equal(asset.subarray(1,4).toString(),'PNG');assert.ok(asset.equals(htmlImage),'Markdown must contain the independently verified flattened image pixels.');}
  const pdfProof=await inspectPDF(pdfReader,pdf,path.join(temporary,'pdf-preview.png'));assert.ok(pdfProof.pages>=1);assert.ok(pdfProof.text.includes('Portable onboarding'));assert.ok(pdfProof.visibleText.includes('Confirm settings'),'The reviewed redacted instruction must remain readable in PDF.');assert.ok(pdfProof.visibleText.includes('Finish setup')&&pdfProof.text.includes('Keep this safe note.')&&pdfProof.visibleText.includes('this safe note.'),'Independent PDF pixels omitted expected safe content: '+JSON.stringify({pages:pdfProof.pages,visibleText:pdfProof.visibleText}));assert.ok(!pdfProof.visibleText.includes('CONTROLLED-SECRET'));assert.ok(!pdfProof.text.includes('CONTROLLED-SECRET'));assert.ok(pdfProof.rendered);pdfPages+=pdfProof.pages;}
  proof={result:'passed',sourceCommit:candidate.commit,harnessCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tool:candidate.version,sdk:candidate.sdk,electron:candidate.electron,macOS:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),arch:process.arch,browser:browser.version(),forms,checks:[...(process.env.GUIDES_TEST_SAFE_DIAGNOSTICS==='1'?['malformed import shows safe recovery guidance without contents in UI or Electron diagnostics and preserves the empty workspace']:[]),'signed installed standalone to suite to fresh standalone via actual editable export/import','stable guide and step identities, ordering, embedded screenshot bytes, crop and all annotation kinds','suite edit retained on return; distinct data roots','duplicate/reorder/delete and crop undo/redo','independent Chrome opens self-contained HTML; cropped opaque redaction pixels verified','Markdown image paths independently read; no originals in read-only output','independent PDFKit text extraction and page rendering; local Vision OCR verifies safe text in rendered pixels','unreviewed sharing is blocked before a destination dialog; reviewed redacted instructions/notes survive in read-only exports','sanitized portable project excludes notes, originals, source/capture context, timestamps and removable overlays','network unavailable in owned application profiles during editing and export'],limits:'Application file destinations controlled; suite installation via actual SDK API, not marketplace UI. Capture/offline browser/native recording not covered by this journey.',pdfPages,documentationForms:documentationSets.map(s=>s.form)};
  await fs.mkdir(path.join(root,'.validation'),{recursive:true});await inspect.screenshot({path:path.join(root,'.validation/packaged-html-export.png'),fullPage:true});await fs.copyFile(path.join(temporary,'pdf-preview.png'),path.join(root,'.validation/packaged-pdf-export.png'));for(const name of (await fs.readdir(temporary)).filter(name=>name.startsWith('pdf-preview.png.page-')))await fs.copyFile(path.join(temporary,name),path.join(root,'.validation/packaged-pdf-export-'+name.slice('pdf-preview.png.'.length)));
 }catch(error){console.error('Packaged project journey failed:',error.message);if(app)for(const p of app.context().pages())console.error('Owned workspace:',p.url(),(await p.locator('body').innerText().catch(()=>'' )).slice(-1200));throw error;}finally{
  if(app)owned=Array.from(new Map([...owned,...captureTree(capture(app.process()))].map(row=>[row.pid,row])).values());
  const cleanupErrors=[];
  if(server){try{crashOwned.push(...captureOwnedCrashHelpers({bundle:browserBundle,baseline:crashBaseline,known:crashOwned}));}catch(error){cleanupErrors.push(error);}browserOwned=Array.from(new Map([...browserOwned,...captureTree(capture(server.process())),...crashOwned].map(row=>[row.pid,row])).values());}
  try{await cleanupDesktop({app,owned});}catch(error){cleanupErrors.push(error);}
  try{await cleanupDesktop({app:server?{process:()=>server.process(),close:async()=>{await browser?.close();await server.close();}}:null,owned:browserOwned,watchdog});}catch(error){cleanupErrors.push(error);}finally{for(const stream of [server?.process().stdout,server?.process().stderr])stream?.destroy();}
  if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Export qualification cleanup failed. Owned cleanup was attempted; inspect unknown processes and retained fixture files.');
  await fs.rm(temporary,{recursive:true,force:true});
 }
 if(proof){proof.cleanup='owned processes and listeners verified absent';await fs.writeFile(path.join(root,'.validation/packaged-project-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS: actual signed packaged cross-form project round-trip and independent documentation inspection; owned cleanup verified.');}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
