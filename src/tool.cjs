const fs=require('node:fs/promises'),path=require('node:path');
exports.activate=async host=>{
 const file=path.join(host.dataDir,'document.txt');let savedText='',saving=false;
 host.handle('com.matiq.guides:request',async(name,text)=>{
  if(name==='load'){try{savedText=await fs.readFile(file,'utf8');return savedText;}catch(e){if(e.code==='ENOENT')return '';throw e;}}
  if(name==='save'){
   if(typeof text!=='string'||text.length>1000000)throw Error('Keep the document under one million characters.');
   if(saving)throw Error('Wait for the current save.');
   saving=true;
   try{const tmp=file+'.tmp';await fs.writeFile(tmp,text,{mode:0o600});await fs.rename(tmp,file);savedText=text;return true;}finally{saving=false;}
  }
  throw Error('Unknown tool command.');
 });
 await host.view.webContents.loadFile(path.join(host.resourceDir,'src/index.html'));
 return {status:async()=>{const current=await host.view.webContents.executeJavaScript("document.querySelector('textarea').value");return {busy:saving||current!==savedText,reason:saving?'saving document':current!==savedText?'save your document first':''};},dispose:async()=>{}};
};