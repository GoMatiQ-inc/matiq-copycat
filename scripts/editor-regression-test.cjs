const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {capture,captureTree}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs'),{cleanupDesktop}=require('@matiq-solutions/sdk/fixture-cleanup.cjs');
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();const root=path.join(__dirname,'..'),temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'copycat-editor-')));let app,owned=[],launched;
 const watchdog=setTimeout(()=>{if(app?.process().exitCode===null)app.process().kill('SIGTERM');},90000);
 try{
  if(process.env.GUIDES_EXECUTABLE_PATH||process.env.GUIDES_SUITE_EXECUTABLE_PATH){launched=await require('./packaged-browser-app.cjs').launchPackagedGuides({root,profile:path.join(temporary,'profile')});app=launched.app;}
  else app=await require('playwright')._electron.launch({args:[path.join(root,'test/fixture-main.cjs'),root,path.join(temporary,'profile')],timeout:20000});
  owned=captureTree(capture(app.process()));const page=launched?.editor||await app.firstWindow();page.setDefaultTimeout(10000);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await page.getByRole('button',{name:'New guide',exact:true}).click();await page.locator('#title').fill('Editor regression');
  for(const instruction of ['Open settings','Save changes']){await page.locator('#add-step').click();await page.locator('#instruction').fill(instruction);}
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  await page.locator('#delete-step').click();assert.equal(await page.locator('#steps li').count(),1);
  await page.locator('#undo').click();assert.equal(await page.locator('#steps li').count(),2);
  await page.locator('#redo').click();assert.equal(await page.locator('#steps li').count(),1);
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  const snapshot=await page.evaluate(()=>window.guides.request('state'));await app.evaluate(({webContents},snapshot)=>{webContents.getAllWebContents().find(w=>w.getURL().endsWith('/src/index.html')).send('com.matiq.guides:state',snapshot);},snapshot);
  await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#steps').children.length===2);assert.equal(await page.locator('#instruction').inputValue(),'Open settings');
  await page.locator('#redo').click();assert.equal(await page.locator('#steps li').count(),1);
  await page.locator('#add-step').click();assert.equal(await page.locator('#redo').isDisabled(),true,'A new edit invalidates redo.');
  if(process.env.COPYCAT_UI_SCREENSHOT){await page.screenshot({path:process.env.COPYCAT_UI_SCREENSHOT});}
  await page.locator('#title').fill('Unsaved title');if(await page.locator('.guide-menu').count())await page.locator('.guide-menu summary').click();await page.locator('#delete-guide').click();await page.waitForFunction(()=>!document.querySelector('#library').hidden);
  assert.equal(await page.locator('#guide-list .guide-card').count(),0,'Confirmed Delete guide must remove saved and unsaved work.');
  console.log(JSON.stringify({result:'passed',form:launched?(launched.suite?'signed suite':'signed standalone'):'SDK development',checks:['delete step','undo','redo','save plus background state update preserves history','new edit invalidates redo','confirmed guide deletion with unsaved edits']}));
 }finally{await cleanupDesktop({app,owned,temporary,watchdog});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
