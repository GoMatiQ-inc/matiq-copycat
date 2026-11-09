import {render} from './render.mjs';
const $=id=>document.getElementById(id),request=(name,args)=>window.guides.request(name,args);
let updateState={enabled:false},captureStatus=null,desktopStatus=null,bridgeStatus=null,project=null,selected=null,rows=[],past=[],future=[],generation=0,editVersion=0,modelRevision=-1,reviewedRevision=null,exportCleanup=false,busy=false,draftTimer=null,draftWrite=null;
window.guidesDispose=()=>{clearTimeout(draftTimer);};
window.guidesDraftSnapshot=()=>project;
window.guidesDirty=false;
window.guidesRender=async({step,asset})=>(await render(step,asset)).toDataURL('image/png');
const clone=value=>JSON.parse(JSON.stringify(value));
const step=()=>project?.guide.steps.find(s=>s.id===selected);
function message(error=''){$('message').textContent=error.message||error;}
function state(label){$('save-state').textContent=label;}
function changed(){reviewedRevision=null;$('sharing-reviewed').checked=false;$('sharing-reviewed').disabled=true;window.guidesDirty=true;editVersion++;state('Unsaved');request('dirty').catch(message);clearTimeout(draftTimer);draftTimer=setTimeout(()=>{if(project&&!busy&&window.guidesDirty)draftWrite=Promise.resolve(draftWrite).then(()=>request('draft',project)).catch(error=>message('Recovery draft failed. Save the guide now: '+error.message));},750);}
const historySnapshot=()=>({...project,...(project.capture?{capture:clone(project.capture)}:{}),guide:clone(project.guide),assets:{...project.assets}});
function remember(){past.push(historySnapshot());if(past.length>20)past.shift();future=[];}
function mutation(fn){if(busy||captureStatus&&['recording','paused'].includes(captureStatus.phase))return;remember();fn();changed();draw();}
async function run(fn){if(busy)return;busy=true;message();document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);try{return await fn();}catch(error){message(error);}finally{busy=false;document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=false);draw();}}
function drawUpdates(){const u=updateState;$('app-updates').hidden=!u.enabled;if(!u.enabled)return;$('update-status').textContent=['Current version '+u.current,u.offer?'Version '+u.offer.version+' · '+Math.ceil(u.offer.bytes/1024/1024)+' MiB':'',u.phase==='downloading'?u.progress+'%':'',u.detail].filter(Boolean).join(' — ');for(const [action,visible]of [['check',true],['download',u.phase==='available'],['restart',u.phase==='ready'],['cleanup',u.phase==='cleanup']]){const button=$('update-'+action);button.hidden=!visible;button.disabled=busy||exportCleanup||(action!=='cleanup'&&u.busy);}}
function accept(result){if(result.updates)updateState=result.updates;if(Number.isSafeInteger(result.revision)&&result.revision<modelRevision)return;modelRevision=result.revision??modelRevision;project=result.project;captureStatus=project?.capture||null;bridgeStatus=result.bridge||null;exportCleanup=!!result.exportCleanup;$('export-cleanup').hidden=!exportCleanup;desktopStatus=result.desktop||null;window.guidesDirty=!!result.unsaved;state(({saved:'Saved',saving:'Saving',failed:'Failed to save',unsaved:'Unsaved'})[result.saveState]||'Unsaved');selected=project?.guide.steps[0]?.id||null;past=[];future=[];message(result.error);draw();}
async function list(){rows=await request('list');drawLibrary();}
function drawLibrary(){const target=$('guide-list');target.replaceChildren();const query=$('search').value.toLowerCase();for(const row of rows.filter(r=>(r.title+' '+r.description).toLowerCase().includes(query))){const button=document.createElement('button');button.className='guide-card';button.disabled=!!row.invalid;const title=document.createElement('strong');title.textContent=row.title;const detail=document.createElement('span');detail.textContent=`${row.steps} steps`;button.append(title,detail);button.onclick=()=>run(async()=>accept(await request('open',row.id)));target.append(button);}if(!target.childElementCount)target.textContent='No matching guides. Create a guide to begin.';}
function draw(){drawContent();$('export-cleanup').hidden=!exportCleanup;if(busy||exportCleanup)document.querySelectorAll('button,input,textarea,select').forEach(b=>b.disabled=true);if(exportCleanup&&!busy)$('export-cleanup').disabled=false;drawUpdates();}
function drawContent(){
  $('library').hidden=!!project;$('editor').hidden=!project;$('privacy').hidden=true;
  if(!project){drawLibrary();return;}
  const active=captureStatus&&['recording','paused'].includes(captureStatus.phase);
  for(const id of ['back','library-nav','title','description','instruction','notes','add-step','save','undo','redo','duplicate-guide','delete-guide','up','down','duplicate-step','delete-step','replace-image','apply-region','clear-annotations','export'])$(id).disabled=!!active;
  $('capture-pause').disabled=captureStatus?.phase!=='recording';$('capture-resume').disabled=captureStatus?.phase!=='paused';$('capture-stop').disabled=!active;$('capture-cancel').disabled=!active;
  $('desktop-workflow').disabled=!!active&&!(captureStatus.source==='desktop'&&captureStatus.phase==='paused');
  $('desktop-start').disabled=!!active&&!(captureStatus.source==='desktop'&&captureStatus.phase==='paused');$('desktop-list').disabled=!!active&&captureStatus.phase==='recording';
  const phase=captureStatus?.source==='desktop'&&captureStatus.phase==='recording'?(desktopStatus?.accepting?(desktopStatus.active?'recording':'starting'):'stopping'):captureStatus?.phase;
  const pending=captureStatus?.source==='desktop'?` Native pending delivery: ${desktopStatus?.pending||0} steps; limit 4 steps or 3 MiB.`:'';
  $('capture-status').textContent=(captureStatus?`${captureStatus.source==='desktop'?'Desktop':'Browser'} capture ${phase}. ${captureStatus.receipts.length} saved steps. `:'')+(bridgeStatus?`${bridgeStatus.instance} · ${bridgeStatus.finishPending?'Finishing: delivering pending browser steps':bridgeStatus.connected?'Browser selected':'Awaiting explicit extension selection'}`:(captureStatus?.source==='desktop'?'':'Choose Desktop workflow, or enable the browser bridge.'))+(captureStatus?.issues.length?' Warnings: '+captureStatus.issues.join(' '):'')+pending;
  $('title').value=project.guide.title;$('description').value=project.guide.description;
  $('steps').replaceChildren();for(const [i,s] of project.guide.steps.entries()){const li=document.createElement('li'),b=document.createElement('button');b.textContent=`${i+1}. ${s.instruction||'Untitled step'}`;b.setAttribute('aria-current',String(s.id===selected));b.onclick=()=>{selected=s.id;draw();};li.append(b);$('steps').append(li);}
  drawCaptureReview(active);drawSharingReview(active);
  const current=step();$('step-editor').hidden=!current;if(!current)return;
  $('instruction').value=current.instruction;$('notes').value=current.notes;drawImage().catch(message);
}
function drawCaptureReview(active){
 const list=$('capture-review');list.replaceChildren();if(!project.capture?.issues.length)return;const help=document.createElement('p');help.textContent='Capture warnings remain until you review them. After stopping, edit sensitive details or explain a correction. Remove a warning only after reviewing and correcting the missing action.';list.append(help);
 project.capture.issues.forEach((reason,index)=>{const label=document.createElement('label'),input=document.createElement('textarea'),remove=document.createElement('button');label.textContent=`Capture warning ${index+1}`;input.value=reason;input.maxLength=1000;input.rows=2;input.disabled=!!active;input.oninput=()=>{if(busy||active)return;remember();project.capture.issues[index]=input.value;changed();};label.append(input);remove.textContent='Mark reviewed and remove';remove.setAttribute('aria-label',`Mark capture warning ${index+1} reviewed and remove`);remove.disabled=!!active;remove.onclick=()=>mutation(()=>project.capture.issues.splice(index,1));list.append(label,remove);});
}
function drawSharingReview(active){
 const redacted=project.guide.steps.map((step,index)=>({step,index})).filter(({step})=>step.annotations.some(a=>a.type==='redact'));
 $('sharing-review').hidden=!redacted.length&&!project.capture?.issues.length;$('sharing-reviewed').checked=reviewedRevision===modelRevision&&!window.guidesDirty;$('sharing-reviewed').disabled=!!active||window.guidesDirty;
 const list=$('sharing-text');list.replaceChildren();const title=document.createElement('h3'),description=document.createElement('p');title.textContent=project.guide.title;description.textContent=project.guide.description;list.append(title,description);
 if(project.capture?.issues.length){const heading=document.createElement('h3');heading.textContent='Capture review warnings';list.append(heading);for(const reason of project.capture.issues){const line=document.createElement('p');line.textContent=reason;list.append(line);}}
 for(const {step,index} of redacted){const heading=document.createElement('h3'),notes=document.createElement('p');heading.textContent=`${index+1}. ${step.instruction}`;notes.textContent=step.notes||'No notes.';list.append(heading,notes);}
 $('sharing-status').textContent=window.guidesDirty?'Save your edits, then review the current wording again.':$('sharing-reviewed').checked?'This saved revision is reviewed. Any edit or new save requires another review.':'Review is required before read-only or sanitized export. Editable projects retain originals.';
}
$('sharing-reviewed').onchange=()=>{reviewedRevision=$('sharing-reviewed').checked&&!window.guidesDirty?modelRevision:null;drawSharingReview(captureStatus&&['recording','paused'].includes(captureStatus.phase));};
async function drawImage(){const token=++generation,s=step(),canvas=$('screenshot');if(!s?.asset){canvas.hidden=true;$('screenshot-status').textContent='No screenshot. Choose Replace screenshot to add one.';return;}const image=await render(s,project.assets[s.asset],{original:true});if(token!==generation)return;canvas.hidden=false;canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);if(s.crop){const c=s.crop,ctx=canvas.getContext('2d');ctx.strokeStyle='#dc7130';ctx.lineWidth=3;ctx.strokeRect(c.x*canvas.width,c.y*canvas.height,c.width*canvas.width,c.height*canvas.height);}$('screenshot-status').textContent=s.crop?'Crop shown in orange. Exports use the cropped region.':'Preview includes opaque redactions. Editable projects still retain the original screenshot.';}
for(const field of ['title','description','instruction','notes'])$(field).addEventListener('input',()=>{if(busy)return;const obj=['title','description'].includes(field)?project.guide:step();if(!obj)return;remember();obj[field]=$(field).value;changed();if(field==='instruction'){const button=$('steps').querySelector('[aria-current=true]');if(button)button.textContent=`${project.guide.steps.indexOf(obj)+1}. ${obj.instruction||'Untitled step'}`;}});
$('search').oninput=drawLibrary;
$('new').onclick=()=>run(async()=>accept(await request('new')));
$('import').onclick=()=>run(async()=>accept(await request('import')));
$('save').onclick=()=>run(async()=>{const version=editVersion;clearTimeout(draftTimer);state('Saving');try{await draftWrite;const result=await request('save',clone(project));if(editVersion===version){modelRevision=Math.max(modelRevision,result.revision??modelRevision);window.guidesDirty=false;state('Saved');message(result.error);}else state('Unsaved');}catch(error){state('Failed to save');throw error;}});
$('back').onclick=$('library-nav').onclick=()=>run(async()=>{if(window.guidesDirty)throw Error('Save your guide before returning to the library.');await list();project=null;selected=null;draw();});
$('privacy-inline').onclick=$('privacy-nav').onclick=()=>{$('privacy').hidden=!$('privacy').hidden;};
$('duplicate-guide').onclick=()=>run(async()=>{await request('duplicate');message('Saved copy added to your library.');});
$('delete-guide').onclick=()=>run(async()=>{accept(await request('delete'));await list();});
$('add-step').onclick=()=>mutation(()=>{const value={id:crypto.randomUUID(),kind:'manual',instruction:'Describe this action',notes:'',timestamp:Date.now(),source:null,asset:null,crop:null,annotations:[]};project.guide.steps.push(value);selected=value.id;});
$('undo').onclick=()=>{if(!past.length)return;future.push(historySnapshot());project=past.pop();if(!step())selected=project.guide.steps[0]?.id;changed();draw();};
$('redo').onclick=()=>{if(!future.length)return;past.push(historySnapshot());project=future.pop();if(!step())selected=project.guide.steps[0]?.id;changed();draw();};
for(const [id,delta] of [['up',-1],['down',1]])$(id).onclick=()=>mutation(()=>{const list=project.guide.steps,i=list.findIndex(s=>s.id===selected),to=i+delta;if(i>=0&&to>=0&&to<list.length)[list[i],list[to]]=[list[to],list[i]];});
$('duplicate-step').onclick=()=>mutation(()=>{const list=project.guide.steps,i=list.indexOf(step()),copy=clone(step());copy.id=crypto.randomUUID();list.splice(i+1,0,copy);selected=copy.id;});
$('delete-step').onclick=()=>mutation(()=>{const list=project.guide.steps,i=list.indexOf(step());list.splice(i,1);selected=list[Math.min(i,list.length-1)]?.id;});
$('replace-image').onclick=()=>run(async()=>{const result=await request('image');if(!result)return;remember();project.assets[result.key]=result.asset;const s=step();s.asset=result.key;s.crop=null;s.annotations=[];changed();draw();});
$('clear-annotations').onclick=()=>mutation(()=>{step().annotations=[];step().crop=null;});
function region(rect){const s=step();if(!s?.asset)throw Error('Add a screenshot before placing a region.');if(!Object.values(rect).every(Number.isFinite)||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>1.000001||rect.y+rect.height>1.000001)throw Error('Keep a non-empty region inside the screenshot.');mutation(()=>{const type=$('annotation').value;if(type==='crop')s.crop=rect;else s.annotations.push({type,...rect,text:$('annotation-text').value});});}
$('apply-region').onclick=()=>{try{region(Object.fromEntries(['x','y','width','height'].map(k=>[k,Number($(k).value)/100])));}catch(error){message(error);}};
const canvas=$('screenshot');let start=null;
const point=e=>{const b=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};};
canvas.onpointerdown=e=>{start=point(e);canvas.setPointerCapture(e.pointerId);};
canvas.onpointerup=e=>{if(!start)return;const end=point(e),rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)};start=null;try{region(rect);}catch(error){message(error);}};
canvas.onpointercancel=()=>{start=null;};
$('export').onclick=()=>run(async()=>{if(window.guidesDirty)throw Error('Save your changes before exporting.');if($('export-format').value!=='editable'&&!$('sharing-review').hidden&&reviewedRevision!==modelRevision){$('sharing-review').open=true;$('sharing-review').querySelector('summary').focus();throw Error('Review the saved sharing text and capture warnings before exporting. Edit sensitive wording, save, then confirm the current review.');}let result;try{result=await request('export',{format:$('export-format').value,...(reviewedRevision===modelRevision?{reviewedRevision}:{})});}catch(error){exportCleanup=!!(await request('state')).exportCleanup;throw error;}if(result.saved)message('Export saved. Open it independently and review sensitive information before sharing.');});
$('export-cleanup').onclick=()=>run(async()=>{const result=await request('export-cleanup');exportCleanup=!!result.exportCleanup;message(result.error||'Export destination released.');});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('save').click();}});
window.guides.subscribe(result=>{if(result.updateOnly){updateState=result.updates;drawUpdates();return;}if(!window.guidesDirty)accept(result);else if(result.error)message(result.error);});
for(const action of ['check','download','restart','cleanup'])$('update-'+action).onclick=()=>run(async()=>{updateState=await request('update-'+action);drawUpdates();});
$('bridge-enable').onclick=()=>run(async()=>accept(await request('bridge-enable')));
$('bridge-install').onclick=()=>run(async()=>{await request('bridge-install',$('bridge-browser').value);message('Native bridge registered. Load the matching browser extension explicitly, then connect and select this instance.');});
$('desktop-workflow').onclick=()=>run(async()=>accept(await request('desktop-workflow')));
$('desktop-list').onclick=()=>run(async()=>{const windows=await request('desktop-list');const select=$('desktop-window');select.replaceChildren();for(const window of windows){const option=document.createElement('option');option.value=window.id;option.textContent=window.application+' — '+window.title;select.append(option);}if(!windows.length)message('No supported windows selected. Open a desktop application, then refresh the window list.');});
$('desktop-start').onclick=()=>run(async()=>accept(await request('desktop-start',Number($('desktop-window').value))));
for(const command of ['pause','resume','stop','cancel'])$('capture-'+command).onclick=()=>run(async()=>accept(await request('capture-control',command)));
await run(async()=>{accept(await request('state'));await list();});
