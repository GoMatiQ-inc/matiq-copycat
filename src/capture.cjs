const {randomUUID}=require('node:crypto');
const P=require('./project.cjs');
const phases=['recording','paused','stopped','cancelled'];
function state(value) {
  if(value===undefined||value===null)return null;
  if(!value||!phases.includes(value.phase)||!['browser','desktop','mixed'].includes(value.source)||!Array.isArray(value.baseSteps)||!Array.isArray(value.receipts)||!Array.isArray(value.issues)||value.baseSteps.length>500||value.receipts.length>500||value.issues.length>100)throw Error('Capture recovery state is invalid. Restore a verified project copy.');
  const identity=id=>{if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw Error('Capture contains an invalid identity.');return id;};
  if(!Number.isSafeInteger(value.started)||value.started<0||!Number.isSafeInteger(value.cutoff)||value.cutoff<0)throw Error('Capture timestamp is invalid.');
  const receipts=value.receipts.map(identity),baseSteps=value.baseSteps.map(identity);if(new Set([...receipts,...baseSteps]).size!==receipts.length+baseSteps.length)throw Error('Capture receipts contain duplicate identities.');
  if(!Array.isArray(value.windows)||!value.windows.length||value.windows.length>100||value.windows.some(w=>!Array.isArray(w)||w.length!==2||!w.every(Number.isSafeInteger)||w[0]<0||w[1]<0||(w[1]&&w[1]<w[0])))throw Error('Capture recording windows are invalid.');
  return {scope:identity(value.scope),windows:value.windows.map(w=>[...w]),id:identity(value.id),phase:value.phase,source:value.source,started:value.started,cutoff:value.cutoff,baseSteps,receipts,issues:value.issues.map(v=>{if(typeof v!=='string'||v.length>1000)throw Error('Capture issue is invalid.');return v;})};
}
function label(value){if(typeof value!=='string')return '';const cleaned=value.trim().replace(/\s+/g,' ');if(cleaned.length>60||/[<>@\r\n]/.test(cleaned)||/password|secret|token|api.?key|bearer|authorization|\b\d{5,}\b|[a-zA-Z0-9_\-]{24,}/i.test(cleaned))return '';return cleaned;}
function instruction(event){
 const control=label(event.label),noun=['button','link','checkbox','radio button','menu item','field','dropdown'].includes(event.control)?event.control:'control';
 if(event.action==='navigate')return `Navigate to ${event.origin}`;
 if(event.action==='fill')return 'Enter the required information in the field';
 if(event.action==='select')return control?`Choose an option in “${control}”`:'Choose an option in the dropdown';
 if(event.action==='toggle')return control?`Change “${control}”`:`Change the ${noun}`;
 if(event.action==='click')return control?`Click “${control}”`:`Click the ${noun}`;
 throw Error('Unsupported capture action. Add an editable manual step for this action.');
}
function addIssue(capture,reason){if(capture.issues.includes(reason))return;if(capture.issues.length<100)capture.issues.push(reason);else capture.issues[99]='More capture warnings occurred than this project can list. The guide may be incomplete; review every step before sharing.';}
function begin(project,source='browser'){
 if(project.capture&&['recording','paused'].includes(project.capture.phase))throw Error('Finish or cancel the current capture before starting another.');
 const next=P.clone(project);next.capture=state({scope:randomUUID(),windows:[[Date.now(),0]],id:randomUUID(),phase:'recording',source,started:Date.now(),cutoff:0,baseSteps:project.guide.steps.map(s=>s.id),receipts:[],issues:project.capture?.issues||[]});return next;
}
function transition(project,command,reason=''){
 const next=P.clone(project),capture=next.capture;if(!capture)throw Error('Start a capture first.');
 if(command==='pause'&&capture.phase==='recording'){capture.phase='paused';capture.cutoff=Date.now();capture.windows.at(-1)[1]=capture.cutoff;}
 else if(command==='resume'&&capture.phase==='paused'){if(capture.windows.length>=100)throw Error('This capture reached 100 recording intervals. Stop it and start another capture.');capture.phase='recording';capture.cutoff=0;capture.windows.push([Date.now(),0]);}
 else if(command==='stop'&&['recording','paused'].includes(capture.phase)){capture.phase='stopped';capture.cutoff=Date.now();if(!capture.windows.at(-1)[1])capture.windows.at(-1)[1]=capture.cutoff;}
 else if(command==='cancel'&&['recording','paused'].includes(capture.phase)){capture.phase='cancelled';capture.cutoff=Date.now();if(!capture.windows.at(-1)[1])capture.windows.at(-1)[1]=capture.cutoff;next.guide.steps=next.guide.steps.filter(s=>capture.baseSteps.includes(s.id));capture.receipts=[];}
 else throw Error('This capture transition is unavailable. Refresh its status and retry.');
 if(reason)addIssue(capture,String(reason).slice(0,1000));return P.compact(next);
}
function append(project,event){
 if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid capture step message. Reconnect the approved extension.');
 const capture=project.capture;if(!capture||event.session!==capture.id||event.scope!==capture.scope)throw Error('Capture session does not match. Select this receiving instance again.');
 if(!Number.isSafeInteger(event.sequence)||event.sequence<0)throw Error('Capture sequence is invalid.');
 if(event.sequence<capture.receipts.length){if(capture.receipts[event.sequence]!==event.id)throw Error('An acknowledged sequence has a different step identity. Stop capture and inspect the extension buffer.');return {project,duplicate:true};}
 if(event.sequence!==capture.receipts.length)throw Error('A capture step is missing. Reconnect and resend the first unacknowledged step.');
 if(!['recording','paused'].includes(capture.phase))throw Error('This capture has ended. Discard its extension buffer explicitly before starting another.');
 if(!Number.isSafeInteger(event.at)||event.at<capture.started||event.at>Date.now()+5000||!capture.windows.some(w=>event.at>=w[0]&&(!w[1]||event.at<=w[1])))throw Error('This action occurred outside active recording. Resume capture before performing it again.');
 if(project.guide.steps.length>=500)throw Error('The guide reached 500 steps. Stop capture and begin another guide.');
 const next=P.clone(project),s=P.step();s.id=event.id;s.timestamp=event.at;
 if(!['browser','desktop'].includes(event.source)||![event.source,'mixed'].includes(capture.source))throw Error('The action source is outside this capture scope.');
 s.kind=event.source;s.instruction=instruction(event);
 if(event.source==='browser'){
  const url=new URL(event.origin);if(!['https:','http:'].includes(url.protocol)||url.origin!==event.origin)throw Error('Browser context must be an HTTP(S) origin without paths or query data.');
  s.source={origin:url.origin};
 }else{
  if(event.action!=='click'||typeof event.application!=='string'||!event.application.trim()||event.application.length>200)throw Error('Desktop capture requires a selected application and a supported mouse action.');
  s.source={application:event.application};
 }
 if(!event.image||typeof event.image.data!=='string'||event.image.data.length>950000)throw Error('Capture screenshot is missing or exceeds the bridge limit. Reduce its size and retry.');
 const bytes=Buffer.from(event.image.data,'base64');if(bytes.toString('base64')!==event.image.data)throw Error('Capture screenshot encoding is invalid.');
 s.asset=P.addImage(next,bytes);if(next.assets[s.asset].mediaType!==event.image.mediaType)throw Error('Capture image type does not match its bytes.');
 if(event.target)s.annotations=[{type:'box',...P.rect(event.target),text:''}];
 next.guide.steps.push(s);next.capture.receipts.push(s.id);return {project:P.validate(next),duplicate:false};
}
function warn(project,reason){if(typeof reason!=='string'||!reason||reason.length>1000)throw Error('Capture warning must contain up to 1,000 characters.');const next=P.clone(project);if(!next.capture||!['recording','paused'].includes(next.capture.phase))throw Error('No active capture is available for this warning.');addIssue(next.capture,reason);return P.validate(next);}
module.exports={state,begin,transition,append,instruction,warn};
