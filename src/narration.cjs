const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const P=require('./project.cjs'),D=require('./desktop.cjs');
function silent(bytes){for(let i=44;i<bytes.length;i+=2)if(bytes.readInt16LE(i)!==0)return false;return true;}
const MODEL={file:'ggml-base.en.bin',bytes:147964211,sha256:'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'};
function audioBytes(value){
 if(!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value))throw Error('Microphone audio must be a bounded byte buffer.');if(value.byteLength>960044)throw Error('Microphone audio exceeds its chunk limit.');const b=value instanceof ArrayBuffer?Buffer.from(value):Buffer.from(value.buffer,value.byteOffset,value.byteLength);if(b.length<46||b.length>960044||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.toString('ascii',12,16)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==16000||b.readUInt32LE(28)!==32000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||b.readUInt32LE(4)!==b.length-8||(b.length-44)%2)throw Error('Microphone audio is invalid. Stop narration and choose a working input.');return b;
}
function attach(project,segments){
 const next=P.clone(project),steps=next.guide.steps.filter(s=>!next.capture?.baseSteps.includes(s.id));if(!steps.length)throw Error('Narration has no new screenshot step to attach to. Perform an action before finishing, or retry its retained audio in the original guide.');
 const additions=new Map();for(const segment of segments){if(!Number.isSafeInteger(segment.at)||typeof segment.text!=='string'||segment.text.length>10000)throw Error('Local transcription is invalid. Retry the retained narration.');const text=segment.text.trim();if(!text)continue;const step=steps.findLast(s=>s.timestamp<=segment.at)||steps[0];additions.set(step.id,(additions.get(step.id)||[]).concat(text));}
 for(const step of steps){const text=additions.get(step.id)?.join(' ');if(text){if(step.instruction.length+text.length+2>10000)throw Error('Spoken instructions exceed a step’s text limit. Shorten the guide and retry narration.');if(!step.instruction.endsWith('\n\n'+text))step.instruction+='\n\n'+text;}}return P.validate(next);
}
async function verified(file){try{const st=await fs.stat(file);if(!st.isFile()||st.size!==MODEL.bytes)return false;const h=createHash('sha256'),handle=await fs.open(file);try{for await(const b of handle.createReadStream())h.update(b);}finally{await handle.close();}return h.digest('hex')===MODEL.sha256;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function create({host,app,dialog,systemPreferences,apply,changed}){
 const root=path.join(host.dataDir,'narration'),shared=host.sharedModelRoot||path.join(app.getPath('appData'),'MatiQ','Models');let model=null,job=null,queue=Promise.resolve(),worker=null,controller=null,failure='',busy=false,finishing=null;
 const status=()=>({ready:!!model,active:!!job,busy:busy||!!job?.pending,downloading:!!controller,error:failure});
 async function prepare(requestMicrophone=true){
  if(job)throw Error('Finish the current narration first.');
  if(!model){try{const config=JSON.parse(await fs.readFile(path.join(host.dataDir,'speech-model.json'),'utf8'));if(typeof config.path==='string')model=config.path;}catch(error){if(error.code!=='ENOENT')failure='Choose the local speech model again; its saved selection could not be read.';}}
  let available=null;for(const file of [model,path.join(shared,'asr',MODEL.sha256,MODEL.file),path.join(app.getPath('appData'),'MatiQ Voice','models',MODEL.file)].filter(Boolean))if(await verified(file)){available=file;break;}model=available;
  if(!model){const choice=await dialog.showMessageBox(host.window,{type:'question',message:'Enable local voice transcription?',detail:'Base English needs a 148 MB local speech model and roughly 1 GB of working memory. Audio stays on this Mac. Choose an existing compatible model, or explicitly download it once. Desktop recording works without it.',buttons:['Cancel','Choose existing model','Download Base English (148 MB)'],cancelId:0,defaultId:0});
   if(choice.response===1){const selected=await dialog.showOpenDialog(host.window,{title:'Choose Base English speech model',properties:['openFile'],filters:[{name:'Local speech model',extensions:['bin']}]});if(selected.canceled)throw Error('Voice setup cancelled.');if(!await verified(selected.filePaths[0]))throw Error('Choose the verified Base English ggml-base.en.bin model (148 MB).');model=selected.filePaths[0];}
   else if(choice.response===2){const target=path.join(shared,'asr',MODEL.sha256,MODEL.file);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});const unlock=await P.lock(target);controller=new AbortController();busy=true;changed();let pending=target+'.'+randomUUID()+'.partial';try{const disk=await fs.statfs(path.dirname(target));if(Number(disk.bavail)*Number(disk.bsize)<MODEL.bytes+2*1024**3)throw Error('Free space for the local model, leaving at least 2 GiB available.');const response=await fetch('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'+MODEL.file,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15*60*1000)])});if(!response.ok||!response.body)throw Error('Local speech model download failed. Check the connection and retry.');let bytes=0;const hash=createHash('sha256'),file=await fs.open(pending,'wx',0o600);try{for await(const b of response.body){bytes+=b.length;if(bytes>MODEL.bytes)throw Error('Speech model download exceeds its verified size.');hash.update(b);await file.write(b);}await file.sync();}finally{await file.close();}if(bytes!==MODEL.bytes||hash.digest('hex')!==MODEL.sha256)throw Error('Speech model verification failed. Retry the download.');await fs.rename(pending,target);model=target;}finally{controller=null;busy=false;await fs.rm(pending,{force:true});await unlock();changed();}}
   else throw Error('Voice setup cancelled. Desktop recording is available without narration.');
  }
  await P.atomicBytes(path.join(host.dataDir,'speech-model.json'),Buffer.from(JSON.stringify({path:model,sha256:MODEL.sha256})));
  if(requestMicrophone&&!await systemPreferences.askForMediaAccess('microphone'))throw Error('Microphone permission was denied. Enable it for Copycat or MatiQ Solutions in macOS Privacy & Security, or record with voice off.');
  return {ready:true};
 }
 async function begin(project){if(!model||job)throw Error('Prepare local voice transcription before recording.');await fs.mkdir(root,{recursive:true,mode:0o700});const id=randomUUID(),directory=path.join(root,id);await fs.mkdir(directory,{mode:0o700});job={id,directory,guide:project.guide.id,capture:project.capture.id,sequence:0,pending:0,segments:[],error:null};failure='';await P.atomicBytes(path.join(directory,'job.json'),Buffer.from(JSON.stringify({guide:job.guide,capture:job.capture,model})));changed();return {id};}
 function enqueue(current,index,at){
  current.pending++;
  queue=queue.then(async()=>{
   if(current.error||current.cancelled)return;busy=true;changed();
   const file=path.join(current.directory,String(index)+'.wav');if(silent(audioBytes(await fs.readFile(file))))return;
   const program=await D.executable(host),prefix=path.join(current.directory,String(index)+'-text');
   const owned=spawn(program,['transcribe',model,file,prefix],{stdio:['pipe','ignore','ignore']});worker=owned;owned.stdin.on('error',()=>{});
   try{
    await new Promise((resolve,reject)=>{owned.once('error',reject);owned.once('close',code=>code===0?resolve():reject(Error('Local transcription failed. Narration audio remains on this Mac for retry.')));});
    const info=await fs.stat(prefix+'.json');if(info.size>2*1024*1024)throw Error('Local transcription output exceeds its limit.');
    let output;try{output=JSON.parse(await fs.readFile(prefix+'.json','utf8'));}catch{throw Error('Local transcription output could not be read. Retry the retained narration.');}
    if(!Array.isArray(output.transcription))throw Error('Local transcription output is unsupported.');
    for(const segment of output.transcription){if(!Number.isFinite(segment.offsets?.from)||segment.offsets.from<0||segment.offsets.from>30000||typeof segment.text!=='string'||segment.text.length>10000)throw Error('Local transcription segment is invalid.');current.segments.push({at:at+Math.round(segment.offsets.from),text:segment.text});}
   }finally{if(worker===owned)worker=null;}
  }).catch(()=>{current.error=Error('Local transcription failed. Narration audio remains on this Mac for retry.');failure=current.error.message;}).finally(()=>{current.pending--;busy=false;changed();});
 }
 async function chunk(args){
  if(!job||args?.job!==job.id||args.sequence!==job.sequence||!Number.isSafeInteger(args.at)||args.at>Date.now()+5000||args.at<0||job.sequence>=240)throw Error('Microphone chunk is outside its recording session. Stop narration and retry.');
  const bytes=audioBytes(args.wav),current=job,index=current.sequence,file=path.join(current.directory,String(index)+'.wav');
  await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});await P.atomicBytes(path.join(current.directory,String(index)+'.json'),Buffer.from(JSON.stringify({at:args.at})));current.sequence++;
  if(current.pending>=3){current.error=Error('Local narration fell behind its three-chunk processing limit. Audio is retained on this Mac; stop recording and retry narration.');failure=current.error.message;changed();throw current.error;}
  enqueue(current,index,args.at);return {accepted:true};
 }
 async function finishJob({cancel=false}={}){const current=job;if(!current)return;if(cancel){current.cancelled=true;worker?.stdin.end();}await queue;job=null;try{if(cancel){await fs.rm(current.directory,{recursive:true,force:true});failure='';return;}if(current.error)throw current.error;if(current.segments.length)await apply(current,attach,current.segments);await fs.rm(current.directory,{recursive:true,force:true});}finally{changed();}}
 function finish(options){return finishing??=(finishJob(options).finally(()=>{finishing=null;}));}
 async function retryJob(project){
  if(job||busy)throw Error('Wait for current narration to finish.');await prepare(false);await fs.mkdir(root,{recursive:true,mode:0o700});
  for(const id of await fs.readdir(root)){
   if(!/^[0-9a-f-]{36}$/.test(id))continue;const directory=path.join(root,id),data=JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8'));
   if(data.guide!==project.guide.id)continue;
   if(data.capture!==project.capture?.id)throw Error('Retained narration belongs to an earlier capture. Reopen its original saved project before retrying.');
   const files=(await fs.readdir(directory)).filter(n=>/^\d+\.wav$/.test(n)).sort((a,b)=>parseInt(a)-parseInt(b));
   if(!files.length||files.length>240)throw Error('Retained narration has no usable audio or exceeds its one-hour limit. Preserve its local files before continuing.');
   job={id,directory,guide:data.guide,capture:data.capture,sequence:0,pending:0,segments:[],error:null};
   for(const name of files){
    const index=Number.parseInt(name),metadata=JSON.parse(await fs.readFile(path.join(directory,index+'.json'),'utf8'));
    if(index!==job.sequence||!Number.isSafeInteger(metadata.at)||metadata.at<0)throw Error('Retained narration is incomplete. Preserve its local files before continuing.');
    audioBytes(await fs.readFile(path.join(directory,name)));job.sequence++;enqueue(job,index,metadata.at);await queue;
   }
   await finish();
  }failure='';changed();
 }
 async function retry(project){try{await retryJob(project);}catch{await queue;job=null;failure='Narration retry failed. Its audio remains local. Reopen the original guide, verify its model and audio files, then retry.';changed();throw Error(failure);}}
 async function discard(project){
  let names;try{names=await fs.readdir(root);}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const id of names){if(!/^[0-9a-f-]{36}$/.test(id))continue;const directory=path.join(root,id);let data;try{data=JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8'));}catch{throw Error('Retained narration cleanup failed. Preserve its local files and retry cancellation.');}if(data.guide===project.guide.id&&data.capture===project.capture?.id)await fs.rm(directory,{recursive:true,force:true});}
  failure='';changed();
 }
 async function recover(project){try{for(const id of await fs.readdir(root)){if(!/^[0-9a-f-]{36}$/.test(id))continue;const data=JSON.parse(await fs.readFile(path.join(root,id,'job.json'),'utf8'));if(data.guide===project.guide.id){failure='Narration was interrupted. Its audio is retained locally; stop capture and choose Retry narration.';break;}}}catch(e){if(e.code!=='ENOENT')failure='Narration recovery needs attention. Preserve its local files before retrying.';}changed();}
 async function dispose(){controller?.abort();if(worker){worker.stdin.end();await new Promise(resolve=>{if(worker.exitCode!==null)return resolve();worker.once('close',resolve);});}await queue;}
 function reportError(kind){failure=kind==='limit'?'Narration reached its one-hour limit. Stop this guide and begin another.':'Microphone capture stopped. Narration may be incomplete; stop and retry its retained audio.';if(job)job.error=Error(failure);changed();}
 return {status,reportError,prepare,begin,chunk,finish,retry,recover,discard,dispose,cancelDownload:()=>controller?.abort()};
}
module.exports={MODEL,audioBytes,silent,attach,create};
