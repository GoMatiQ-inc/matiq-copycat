const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),P=require('../src/project.cjs');
async function exerciseInvalidImports(app,page,directory){
 const canary='CONTROLLED-IMPORT-SECRET',state=await page.evaluate(()=>window.guides.request('state'));assert.equal(state.project,null,'Run import rejection checks before opening a guide.');
 const invalid=P.create('Controlled rejected import');invalid.guide.steps.push({...P.step(),kind:'browser',source:{origin:canary}});
 const cases=[{bytes:canary,message:'invalid JSON'},{bytes:JSON.stringify(invalid),message:'HTTP(S) origin'}];
 const messages=[];let diagnostics='';const collect=part=>{diagnostics=(diagnostics+part.toString()).slice(-20000);};app.process().stderr.on('data',collect);app.process().stdout.on('data',collect);
 try{for(let i=0;i<cases.length;i++){
  const file=path.join(directory,'invalid-import-'+i+'.mqguide'),before=cases[i].bytes;await fs.writeFile(file,before);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  const previous=await page.locator('#message').innerText();await page.getByRole('button',{name:'Import editable project',exact:true}).click();await page.waitForFunction(previous=>{const text=document.querySelector('#message').textContent;return text&&text!==previous;},previous);
  const message=await page.locator('#message').innerText();messages.push(message);assert.ok(!message.includes(canary),'Rejected project content entered the visible error.');assert.equal((await page.evaluate(()=>window.guides.request('state'))).project,null);assert.equal(await fs.readFile(file,'utf8'),before,'Rejected input bytes changed.');
 }
 await new Promise(resolve=>setTimeout(resolve,100));assert.ok(!diagnostics.includes(canary),'Rejected project content entered Electron diagnostics.');for(let i=0;i<cases.length;i++)assert.ok(messages[i].includes(cases[i].message),'Rejected import needs actionable recovery guidance.');
 }finally{app.process().stderr.off('data',collect);app.process().stdout.off('data',collect);}
 console.log('PASS: invalid JSON and malformed source origin rejected through actual SDK IPC without input in UI/diagnostics; original files and empty workspace retained.');
}
module.exports={exerciseInvalidImports};
