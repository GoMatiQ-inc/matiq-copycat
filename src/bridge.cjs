const net=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,randomBytes,timingSafeEqual}=require('node:crypto');
const {once}=require('node:events');
const LIMIT=1024*1024;
function frame(value){const body=Buffer.from(JSON.stringify(value));if(body.length>LIMIT)throw Error('Bridge message exceeds one MiB.');const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);}
function decoder(receive,fail){let buffer=Buffer.alloc(0),failed=false;return chunk=>{if(failed)return;try{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(!size||size>LIMIT)throw Error('Invalid bridge frame size.');if(buffer.length<size+4)break;const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(4,size+4)));buffer=buffer.subarray(size+4);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Bridge messages must be objects.');receive(value);}if(buffer.length>LIMIT+4)throw Error('Bridge input buffer exceeded its limit.');}catch(error){failed=true;buffer=Buffer.alloc(0);fail(error);}};}
async function start({directory,instance,origins,receive,disconnect,report=()=>{}}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))throw Error('The Copycat bridge directory must be private to this user. Repair its permissions before connecting.');
 const descriptor=path.join(directory,'active.json'),nonce=randomUUID(),token=randomBytes(32).toString('hex'),socketPath=path.join(directory,`g-${process.pid}.sock`);
 try {const old=JSON.parse(await fs.readFile(descriptor,'utf8'));if(!Number.isSafeInteger(old.pid)||old.pid<1)throw Error('Bridge ownership is damaged. Inspect the active record before retrying.');try{process.kill(old.pid,0);throw Error('Another Copycat bridge is active. Close its receiving instance first.');}catch(error){if(error.code!=='ESRCH')throw error;}await fs.unlink(descriptor);}catch(error){if(error.code!=='ENOENT')throw error;}
 const clients=new Set(),operations=new Set();let closing=false,disposed=false,descriptorRemoved=false;
 const server=net.createServer(socket=>{
  const client={socket,authenticated:false,rejected:false,origin:null};clients.add(client);let queue=Promise.resolve(),pending=0;
  const send=value=>{if(!socket.destroyed){if(socket.writableLength>2*LIMIT){socket.destroy();return;}socket.write(frame(value));}};
  socket.setTimeout(60000,()=>socket.destroy());
  socket.on('error',()=>socket.destroy());
  socket.on('close',()=>{clients.delete(client);if(client.authenticated&&!closing){const operation=Promise.resolve().then(()=>disconnect?.(client)).catch(error=>report(error)).finally(()=>operations.delete(operation));operations.add(operation);}});
  socket.on('data',decoder(value=>{
   if(++pending>16){socket.destroy();return;}
   const operation=queue.then(async()=>{
    if(closing||client.rejected||socket.destroyed)return;
    if(!client.authenticated){
     const proposed=typeof value.token==='string'?Buffer.from(value.token):Buffer.alloc(0),expected=Buffer.from(token);
     if(value.v!==1||value.type!=='authenticate'||!origins.includes(value.origin)||proposed.length!==expected.length||!timingSafeEqual(proposed,expected)){send({v:1,type:'error',error:'Bridge authentication failed. Reinstall the approved bridge and extension.'});client.rejected=true;socket.end();return;}
     client.authenticated=true;client.origin=value.origin;send({v:1,type:'ready',instance,receiver:nonce});return;
    }
    if(value.v!==1||typeof value.requestId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.requestId)){send({v:1,type:'error',error:'Unsupported bridge protocol or request identity. Update the extension and receiving tool together.'});client.rejected=true;socket.end();return;}
    try{const result=await receive(value,client);send({v:1,requestId:value.requestId,result});}catch(error){send({v:1,requestId:value.requestId,error:error.message});}
   }).catch(error=>{report(error);socket.destroy();}).finally(()=>{pending--;operations.delete(operation);});queue=operation;operations.add(operation);
  },()=>socket.destroy()));
 });
 try{
  server.listen(socketPath);await once(server,'listening');await fs.chmod(socketPath,0o600);
  await fs.writeFile(descriptor,JSON.stringify({v:1,pid:process.pid,nonce,token,socket:socketPath,instance}),{flag:'wx',mode:0o600});
 }catch(error){for(const client of clients)client.socket.destroy();server.close();try{await fs.unlink(socketPath);}catch(e){if(e.code!=='ENOENT')throw new AggregateError([error,e],'Bridge startup cleanup failed. Inspect its owned socket.');}throw error;}
 return {
  receiver:nonce,
  broadcast(event){for(const client of clients)if(client.authenticated&&!client.rejected&&!client.socket.destroyed)client.socket.write(frame({v:1,type:'event',event}));},
  async dispose(){if(disposed)return;closing=true;for(const client of clients)client.socket.destroy();await Promise.all([...operations]);await new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));if(!descriptorRemoved){const saved=JSON.parse(await fs.readFile(descriptor,'utf8'));if(saved.nonce!==nonce)throw Error('Bridge ownership changed. Inspect the active record before retrying cleanup.');await fs.unlink(descriptor);descriptorRemoved=true;}try{await fs.unlink(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}disposed=true;}
 };
}
module.exports={start,frame,decoder,LIMIT};
