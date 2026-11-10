const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const P=require('../src/project.cjs'),C=require('../src/capture.cjs'),B=require('../src/bridge.cjs');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {once}=require('node:events');
const image={mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII='};
function event(p,more={}){return {id:randomUUID(),sequence:p.capture.receipts.length,session:p.capture.id,scope:p.capture.scope,at:Date.now(),source:'browser',origin:'https://example.com',action:'click',control:'button',label:'Settings',target:{x:0,y:0,width:.5,height:.5},image,...more};}
test('browser event becomes a structured illustrated step and retries do not duplicate it',()=>{const p=C.begin(P.create()),e=event(p),next=C.append(p,e);assert.equal(next.project.guide.steps.length,1);assert.equal(next.project.guide.steps[0].instruction,'Click “Settings”');assert.equal(next.project.guide.steps[0].id,e.id);assert.equal(C.append(next.project,e).duplicate,true);assert.throws(()=>C.append(next.project,{...e,id:randomUUID()}),/different step identity/);});
test('capture rejects sequence gaps, wrong sessions, invalid origins and unsupported sources',()=>{const p=C.begin(P.create());assert.throws(()=>C.append(p,event(p,{sequence:1})),/missing/);assert.throws(()=>C.append(p,event(p,{session:randomUUID()})),/session/);assert.throws(()=>C.append(p,event(p,{origin:'https://example.com/?token=private'})),/without paths/);assert.throws(()=>C.append(p,event(p,{source:'desktop'})),/outside/);});
test('pause cuts off future actions, stop keeps steps and cancel restores the original guide',()=>{const original=P.create();original.guide.steps.push(P.step());let p=C.begin(original);p=C.append(p,event(p)).project;const paused=C.transition(p,'pause');assert.throws(()=>C.append(paused,event(paused,{at:paused.capture.cutoff+1})),/outside active/);const stopped=C.transition(paused,'stop');assert.equal(stopped.guide.steps.length,2);assert.throws(()=>C.append(stopped,event(stopped)),/ended/);const cancelled=C.transition(paused,'cancel');assert.deepEqual(cancelled.guide.steps,original.guide.steps);assert.deepEqual(cancelled.assets,{});});
test('captured form values and sensitive-looking labels are not instructions',()=>{const p=C.begin(P.create());const e=event(p,{action:'fill',label:'Secret password',value:'never include',typed:'never include'});const next=C.append(p,e).project;assert.equal(next.guide.steps[0].instruction,'Enter the required information in the field');assert.ok(!JSON.stringify(next).includes('never include'));assert.equal(C.instruction({...e,action:'click',label:'Bearer abcd1234'}),'Click the button');});
test('editing a stopped guide may delete captured steps while preserving receipt history',()=>{let p=C.begin(P.create());p=C.append(p,event(p)).project;p=C.transition(p,'stop');p.guide.steps=[];assert.doesNotThrow(()=>P.compact(p));});
test('bridge framing handles arbitrary chunk boundaries and rejects oversized messages',()=>{const values=[],errors=[],decode=B.decoder(x=>values.push(x),e=>errors.push(e));const bytes=Buffer.concat([B.frame({v:1,a:'one'}),B.frame({v:1,a:'two'})]);for(const byte of bytes)decode(Buffer.from([byte]));assert.deepEqual(values,[{v:1,a:'one'},{v:1,a:'two'}]);const huge=Buffer.alloc(4);huge.writeUInt32LE(B.LIMIT+1);decode(huge);assert.equal(errors.length,1);});
test('actual private socket authenticates, validates requests and cleans up its endpoint',{timeout:10000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'guides-bridge-'));let service,socket;
 t.after(async()=>{socket?.destroy();if(service)await service.dispose();await fs.rm(directory,{recursive:true,force:true});});
 service=await B.start({directory,instance:'Test receiver',origins:['approved'],receive:async message=>{if(message.type!=='status')throw Error('Unsupported command.');return {connected:true};}});
 const record=JSON.parse(await fs.readFile(path.join(directory,'active.json'),'utf8'));assert.equal((await fs.stat(record.socket)).mode&0o777,0o600);
 socket=net.createConnection(record.socket);await once(socket,'connect');const queue=[],waiting=[];socket.on('data',B.decoder(value=>waiting.length?waiting.shift()(value):queue.push(value),error=>{throw error;}));const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiting.push(resolve));
 socket.write(B.frame({v:1,type:'authenticate',token:record.token,origin:'approved'}));assert.equal((await next()).type,'ready');
 socket.write(B.frame({v:1,type:'status',requestId:'status-1'}));assert.deepEqual((await next()).result,{connected:true});
 socket.write(B.frame({v:2,type:'status',requestId:'status-2'}));assert.match((await next()).error,/Unsupported bridge protocol/);
 socket.destroy();await service.dispose();service=null;await assert.rejects(fs.access(record.socket),{code:'ENOENT'});await assert.rejects(fs.access(path.join(directory,'active.json')),{code:'ENOENT'});
});

test('resume does not admit actions timestamped inside a paused interval',()=>{const now=Date.now;let clock=1000;Date.now=()=>clock;try{let p=C.begin(P.create());clock=1100;p=C.transition(p,'pause');clock=1300;p=C.transition(p,'resume');assert.throws(()=>C.append(p,event(p,{at:1200})),/outside active/);assert.equal(C.append(p,event(p,{at:1300})).project.guide.steps.length,1);}finally{Date.now=now;}});

test('active capture inventory cannot silently discard pre-existing steps on cancellation',()=>{const p=P.create();p.guide.steps.push(P.step());const current=C.begin(p);current.capture.baseSteps=[];assert.throws(()=>P.validate(current),/inventory is inconsistent/);});

test('private bridge rejects an unapproved identity and an incorrect token before dispatch',{timeout:10000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'guides-auth-'));let calls=0,service;const sockets=[];
 t.after(async()=>{for(const socket of sockets)socket.destroy();await service?.dispose();await fs.rm(directory,{recursive:true,force:true});});
 service=await B.start({directory,instance:'Auth fixture',origins:['approved'],receive:async()=>{calls++;return {};}});const record=JSON.parse(await fs.readFile(path.join(directory,'active.json'),'utf8'));
 for(const auth of [{origin:'unapproved',token:record.token},{origin:'approved',token:'0'.repeat(64)}]){
  const socket=net.createConnection(record.socket);sockets.push(socket);await once(socket,'connect');const response=new Promise((resolve,reject)=>socket.on('data',B.decoder(resolve,reject)));socket.write(B.frame({v:1,type:'authenticate',...auth}));assert.equal((await response).type,'error');socket.destroy();
 }
 assert.equal(calls,0);
});

test('desktop steps join browser guides without recording values or inventing unknown control names',()=>{
 let p=C.begin(P.create());p=C.append(p,event(p)).project;p=C.transition(p,'stop');const browser=p.guide.steps[0].id;
 p=C.begin(p,'desktop');p=C.append(p,event(p,{source:'desktop',application:'Guides Native Fixture',label:'',control:'unknown',value:'CONTROLLED-SECRET',url:'https://invalid.test/private'})).project;
 assert.equal(p.guide.steps[0].id,browser);assert.equal(p.guide.steps[1].kind,'desktop');assert.equal(p.guide.steps[1].instruction,'Click the control');
 assert.deepEqual(p.guide.steps[1].source,{application:'Guides Native Fixture'});assert.ok(!JSON.stringify(p).includes('CONTROLLED-SECRET'));assert.ok(!JSON.stringify(p).includes('/private'));
 assert.throws(()=>C.append(p,event(p)),/outside/);
 const cancelled=C.transition(p,'cancel');assert.equal(cancelled.guide.steps.length,1);assert.equal(cancelled.guide.steps[0].id,browser);
});

test('saved capture gaps survive later browser/native sessions and cancellation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'guides-warnings-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'guide.mqguide');
 let p=C.begin(P.create());p=C.append(p,event(p)).project;const first=p.guide.steps[0].id,reason='A browser action was not saved. Review the incomplete guide.';p=C.warn(p,reason);p=C.transition(p,'stop');
 p=C.begin(p,'desktop');assert.deepEqual(p.capture.issues,[reason]);p=C.append(p,event(p,{source:'desktop',application:'Controlled native app'})).project;p=C.transition(p,'cancel');assert.deepEqual(p.guide.steps.map(s=>s.id),[first]);
 p=C.begin(p);p=C.transition(p,'stop');await P.atomicWrite(file,p);const reopened=await P.read(file);assert.deepEqual(reopened.capture.issues,[reason]);assert.equal(reopened.guide.steps[0].id,first);assert.equal(reopened.version,1);
});
test('bounded warning retention keeps older gaps and explicitly reports overflow',()=>{
 let p=C.begin(P.create());for(let i=0;i<101;i++)p=C.warn(p,'Controlled missing action '+i);assert.equal(p.capture.issues.length,100);assert.equal(p.capture.issues[0],'Controlled missing action 0');assert.match(p.capture.issues.at(-1),/More capture warnings.*review every step/);
 p=C.transition(p,'pause','Controlled missing action 0');assert.equal(p.capture.issues.length,100);p=C.transition(p,'stop');p=C.begin(p,'desktop');assert.equal(p.capture.issues[0],'Controlled missing action 0');assert.match(p.capture.issues.at(-1),/More capture warnings/);
});

test('invalid captured origins fail with safe diagnostics and leave capture unchanged',()=>{const {inspect}=require('node:util'),p=C.begin(P.create()),before=JSON.stringify(p),canary='CONTROLLED-CAPTURE-SECRET';for(const origin of [canary,17,{input:canary},'https://example.com/?token='+canary]){assert.throws(()=>C.append(p,event(p,{origin})),error=>{assert.match(error.message,/HTTP\(S\) origin/);assert.ok(!inspect(error).includes(canary));assert.equal(error.input,undefined);assert.equal(error.cause,undefined);return true;});assert.equal(JSON.stringify(p),before);}});

test('unverified native target is omitted and visibly requires manual review',()=>{const p=C.begin(P.create(),'desktop'),e=event(p,{source:'desktop',application:'Controlled native app',reviewTarget:true});const next=C.append(p,e).project;assert.deepEqual(next.guide.steps[0].annotations,[]);assert.match(next.capture.issues.join(' '),/highlight manually/);assert.throws(()=>C.append(p,{...e,reviewTarget:'yes'}),/review state/);});

test('desktop workflow actions use bounded rule-based wording and never retain raw interaction values',()=>{
 for(const [action,more,expected] of [
  ['right-click',{},'Right-click “Settings”'],['double-click',{},'Double-click “Settings”'],['drag',{destination:{x:.6,y:.6,width:.02,height:.02}},'Drag “Settings” from callout 1 to callout 2'],
  ['scroll',{},'Scroll to the required content'],['fill',{},'Enter the required information in the field'],['shortcut',{shortcut:'save'},'Save'],['shortcut',{shortcut:'paste'},'Paste']
 ]){
  const p=C.begin(P.create(),'desktop'),e=event(p,{source:'desktop',application:'Controlled desktop app',action,...more,typed:'CONTROLLED-RAW-SECRET',clipboard:'CONTROLLED-RAW-SECRET',value:'CONTROLLED-RAW-SECRET'});
  const next=C.append(p,e).project;assert.equal(next.guide.steps[0].instruction,expected);assert.ok(!JSON.stringify(next).includes('CONTROLLED-RAW-SECRET'));
 }
 const p=C.begin(P.create(),'desktop');assert.throws(()=>C.append(p,event(p,{source:'desktop',application:'Controlled desktop app',action:'shortcut',shortcut:'CONTROLLED-RAW-SECRET'})),/Unsupported desktop shortcut/);
 assert.equal(p.guide.steps.length,0);
});
