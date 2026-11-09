const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path');
async function executable(host){
 if(process.platform!=='darwin')throw Error('Desktop capture is currently available only in the macOS build.');
 for(const base of [host.resourceDir,process.resourcesPath]){
  const file=path.join(base,'native/guides-capture');
  try{const stat=await fs.lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()){await fs.access(file,fs.constants.X_OK);return file;}}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 throw Error('The native capture helper is missing. Reinstall a verified complete MatiQ Copycat package.');
}
function launch(program,args,onMessage){
 const child=spawn(program,args,{stdio:['pipe','pipe','ignore']});let tail=Buffer.alloc(0),failure=null;
 const exited=new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('close',(code,signal)=>{if(failure)reject(failure);else resolve({code,signal});});
 });
 // Avoid an unhandled rejection while a caller is still awaiting ready.
 exited.catch(()=>{});
 child.stdout.on('data',chunk=>{
  tail=Buffer.concat([tail,chunk]);
  let newline;
  while((newline=tail.indexOf(10))>=0){
   const line=tail.subarray(0,newline);tail=tail.subarray(newline+1);
   if(line.length>1000000){failure=Error('Native capture exceeded its message limit. Stop and reduce the selected window size.');child.kill();return;}
   try{const message=JSON.parse(line.toString('utf8'));if(!message||typeof message.type!=='string')throw Error('Invalid native response.');onMessage(message);}catch(error){failure=error;child.kill();return;}
  }
  if(tail.length>1000000){failure=Error('Native capture sent an oversized incomplete message. Reinstall a verified package.');child.kill();}
 });
 child.stdin.on('error',()=>{}); // Exit/stop reports the actual process outcome.
 async function stop(){
  if(child.exitCode!==null||child.signalCode!==null){await exited;return;}
  child.stdin.end('stop\n');
  let timer;try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native capture did not stop. Retry cleanup before closing Copycat.')),5000);})]);}
  catch(error){child.kill('SIGKILL');let deadline;try{await Promise.race([exited.catch(()=>{}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('The native helper is still present after forced stop. Keep Copycat open and retry cleanup.')),2000);})]);}finally{clearTimeout(deadline);}throw error;}finally{clearTimeout(timer);}
 }
 return {child,exited,stop};
}
async function list(host){
 const program=await executable(host);let result=null,reason='';
 const process=launch(program,['list'],message=>{if(message.type==='windows')result=message.windows;if(message.type==='issue')reason=message.reason;});
 let timer;try{
  await Promise.race([process.exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Window selection timed out. Check the Screen Recording permission dialog, then refresh.')),30000);})]);
  if(!Array.isArray(result))throw Error(reason||'No window list was returned. Check Screen Recording permission and retry.');
  if(result.length>1000||result.some(w=>!Number.isSafeInteger(w.id)||w.id<1||!Number.isSafeInteger(w.pid)||w.pid<1||typeof w.application!=='string'||typeof w.title!=='string'))throw Error('The native window list is invalid. Reinstall a verified package.');
  return result;
 }catch(error){throw Error(reason||error.message);}finally{clearTimeout(timer);if(process.child.exitCode===null&&process.child.signalCode===null)await process.stop();}
}
async function start(host,id,pid,onEvent,onFailure,onControl){
 if(!Number.isSafeInteger(id)||id<0||!Number.isSafeInteger(pid)||pid<0||(id===0)!==(pid===0))throw Error('Select a visible application window.');
 const program=await executable(host);let readyResolve,readyReject,ready=false,expected=false;
 const pending=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const process=launch(program,id===0?['record-desktop']:['record',String(id),String(pid)],message=>{
  if(message.type==='ready'){ready=true;readyResolve();}
  else if(message.type==='issue'){const error=Error(String(message.reason||'Desktop capture was interrupted.').slice(0,1000));if(!ready)readyReject(error);else onFailure(error);}
  else if(message.type==='step'&&ready)onEvent(message);
  else if(message.type==='control'&&ready&&['pause','stop','cancel'].includes(message.command)&&onControl){expected=true;onControl(message.command);}
 });
 process.exited.then(()=>{if(!ready)readyReject(Error('Native capture ended before it was ready. Check permissions and retry.'));else if(!expected)onFailure(Error('Native capture ended. Review saved steps and explicitly resume.'));},error=>{if(!ready)readyReject(error);else if(!expected)onFailure(error);});
 let timer;try{await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native capture did not become ready. Check Accessibility permission and retry.')),15000);})]);}
 catch(error){expected=true;try{await process.stop();}catch(cleanup){throw Error(error.message+' Cleanup failed: '+cleanup.message);}throw error;}finally{clearTimeout(timer);}
 let stopPromise;return {stop:()=>{expected=true;return stopPromise??=(process.stop().catch(error=>{stopPromise=null;throw error;}));},exited:process.exited};
}
module.exports={list,start};
