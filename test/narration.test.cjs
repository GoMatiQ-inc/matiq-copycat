const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/project.cjs'),C=require('../src/capture.cjs'),N=require('../src/narration.cjs');
function wav(samples=16000){const b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);return b;}
test('microphone IPC rejects malformed, stereo and oversized audio before inference',()=>{
 const valid=wav();assert.deepEqual(N.audioBytes(valid),valid);const backing=Buffer.concat([Buffer.alloc(9),valid,Buffer.alloc(9)]);assert.deepEqual(N.audioBytes(backing.subarray(9,9+valid.length)),valid);
 for(const value of [null,'audio',Buffer.alloc(960045),valid.subarray(1),Buffer.alloc(44)])assert.throws(()=>N.audioBytes(value));
 for(const [offset,value] of [[22,2],[24,48000],[28,64000],[40,2]]){const invalid=Buffer.from(valid);invalid.writeUInt32LE(value,offset);assert.throws(()=>N.audioBytes(invalid));}
});
test('spoken segments attach to the current screenshot without changing stable identities or earlier work',()=>{
 const original=P.create(),old=P.step();old.timestamp=50;original.guide.steps.push(old);const project=C.begin(original,'desktop');
 const a=P.step(),b=P.step();a.timestamp=100;b.timestamp=200;project.guide.steps.push(a,b);project.capture.receipts.push(a.id,b.id);const before=JSON.stringify(project);
 const segments=[{at:90,text:' First action. '},{at:150,text:'More detail.'},{at:200,text:'Second action.'}],next=N.attach(project,segments);
 assert.equal(JSON.stringify(project),before);assert.deepEqual(next.guide.steps.map(s=>s.id),[old.id,a.id,b.id]);assert.equal(next.guide.steps[0].instruction,old.instruction);
 assert.equal(next.guide.steps[1].instruction,a.instruction+'\n\nFirst action. More detail.');assert.equal(next.guide.steps[2].instruction,b.instruction+'\n\nSecond action.');
 assert.deepEqual(N.attach(next,segments),next);assert.deepEqual(P.validate(JSON.parse(JSON.stringify(next))).guide.steps,next.guide.steps);
});
test('invalid transcription and missing screenshot fail without mutating the guide',()=>{
 const project=C.begin(P.create(),'desktop');assert.throws(()=>N.attach(project,[{at:1,text:'Speech'}]),/no new screenshot/);
 const step=P.step();step.timestamp=100;project.guide.steps.push(step);project.capture.receipts.push(step.id);const before=JSON.stringify(project);
 for(const segment of [{at:NaN,text:'Speech'},{at:100,text:17},{at:100,text:'x'.repeat(10001)}])assert.throws(()=>N.attach(project,[segment]));
 assert.equal(JSON.stringify(project),before);assert.equal(N.attach(project,[{at:100,text:'   '}]).guide.steps[0].instruction,step.instruction);
});

test('digital silence is excluded from inference without discarding quiet nonzero speech',()=>{const bytes=wav();assert.equal(N.silent(N.audioBytes(bytes)),true);bytes.writeInt16LE(1,44);assert.equal(N.silent(N.audioBytes(bytes)),false);});
