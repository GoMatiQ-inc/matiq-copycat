// Reuse the qualified first-party speech-engine build; never download a model here.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const sha='c5cb001ef7be6db4ed46758ce1e9db0641daf350c3bac3907dc5bda392c3a6db';
(async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'copycat-engine-'));
 try{
  const archive=path.join(temporary,'engine.mqt');let bytes;
  if(process.env.COPYCAT_ENGINE_PACKAGE)bytes=await fs.readFile(process.env.COPYCAT_ENGINE_PACKAGE);
  else{const response=await fetch('https://github.com/GoMatiQ-inc/matiq-voice/releases/download/v0.3.13/MatiQ-Voice-0.3.13-darwin-arm64.mqt',{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Speech engine download failed. Retry or set COPYCAT_ENGINE_PACKAGE to the verified release package.');bytes=Buffer.from(await response.arrayBuffer());}
  if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('Speech engine package hash mismatch. Preserve the file for inspection; do not execute it.');
  await fs.writeFile(archive,bytes);
  for(const [member,name] of [['engine/whisper-cli','whisper-cli'],['engine/WHISPER-LICENSE','WHISPER-LICENSE'],['engine/build.json','speech-engine-build.json']]){
   const content=execFileSync('python3',['-c','import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',archive,member],{maxBuffer:16*1024*1024,timeout:30000});
   await fs.writeFile(path.join(__dirname,'../native',name),content,{mode:name==='whisper-cli'?0o755:0o644});
  }
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
