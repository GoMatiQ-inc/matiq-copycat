const assert=require('node:assert/strict');
async function exerciseEmbeddedFrame({evaluate,clickFrame,readProject}){
 const before=await readProject(),count=before.guide.steps.length;assert.equal(before.capture.phase,'recording');assert.ok(!before.capture.issues.some(reason=>reason.includes('embedded frames')),'Use a frame-free fixture before checking dynamic frame detection.');
 try{
  await evaluate(()=>{const frame=document.createElement('iframe');frame.id='guides-frame-fixture';frame.style.cssText='position:fixed;left:0;bottom:0;width:200px;height:80px';frame.srcdoc='<button id="frame-action" onclick="document.body.dataset.trusted=String(event.isTrusted)">Frame-only action</button>';document.body.append(frame);});
  let current;for(let i=0;i<100;i++){current=await readProject();if(current.capture.issues.some(reason=>reason.includes('embedded frames')))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(current.capture.issues.some(reason=>reason.includes('embedded frames')),'A frame added after recording starts must produce a saved unsupported-frame warning.');
  assert.equal(await clickFrame(),true,'The controlled frame button must receive actual trusted input.');await new Promise(resolve=>setTimeout(resolve,600));current=await readProject();assert.equal(current.guide.steps.length,count,'Unsupported frame actions must not become invented top-level steps.');assert.deepEqual(current.assets,before.assets,'Frame-only actions must not add captured images.');
  await evaluate(()=>{document.querySelector('#guides-frame-fixture').remove();const frame=document.createElement('iframe');frame.id='guides-frame-fixture';document.body.append(frame);});await new Promise(resolve=>setTimeout(resolve,400));current=await readProject();assert.equal(current.capture.issues.filter(reason=>reason.includes('embedded frames')).length,1,'Frame changes must not duplicate the same saved warning.');
 }finally{await evaluate(()=>document.querySelector('#guides-frame-fixture')?.remove());}
 console.log('PASS: dynamically added embedded frame produces one canonical warning; a trusted frame click adds no invented step or screenshot.');
}
module.exports={exerciseEmbeddedFrame};
