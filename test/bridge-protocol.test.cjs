const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{once}=require('node:events'),B=require('../src/bridge.cjs');
async function rejected(frames,authenticated){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'guides-protocol-'));let bridge,socket,timer;let actions=0,disconnects=0,decodingFailed=false;const messages=[];
 try{
  bridge=await B.start({directory,instance:'Controlled protocol receiver',origins:['controlled-extension'],receive:async()=>{actions++;return {accepted:true};},disconnect:async()=>{disconnects++;}});
  const d=JSON.parse(await fs.readFile(path.join(directory,'active.json'),'utf8'));
  socket=net.createConnection(d.socket);socket.on('error',()=>{});await once(socket,'connect');socket.on('data',B.decoder(message=>messages.push(message),()=>{decodingFailed=true;}));
  const authenticate={v:1,type:'authenticate',token:d.token,origin:'controlled-extension'};
  async function waitFor(predicate){for(let i=0;i<100;i++){assert.equal(decodingFailed,false,'The bridge returned an invalid controlled protocol frame.');if(predicate())return;await new Promise(resolve=>{timer=setTimeout(resolve,10);});}throw Error('The controlled bridge did not return its expected protocol result.');}
  if(authenticated){socket.write(B.frame(authenticate));await waitFor(()=>messages.some(m=>m.type==='ready'));}
  socket.write(Buffer.concat(frames(authenticate).map(B.frame)));await waitFor(()=>messages.some(m=>m.type==='error'));await new Promise(resolve=>{timer=setTimeout(resolve,30);});
  assert.equal(actions,0,'A rejected connection must not deliver later queued actions to the guide owner.');await waitFor(()=>socket.destroyed);if(authenticated)await waitFor(()=>disconnects===1);else assert.equal(disconnects,0);
 }finally{clearTimeout(timer);socket?.destroy();if(bridge)await bridge.dispose();await fs.rm(directory,{recursive:true,force:true});}
}
test('a rejected authenticated protocol cannot deliver subsequent queued guide actions',{timeout:3000},()=>rejected(()=>[{v:2,requestId:'wrong-version',type:'step'},{v:1,requestId:'later-action',type:'step'}],true));
test('failed authentication cannot be repaired inside the same rejected connection',{timeout:3000},()=>rejected(auth=>[{...auth,token:'incorrect'},auth,{v:1,requestId:'later-action',type:'step'}],false));
