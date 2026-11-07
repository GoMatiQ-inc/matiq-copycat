import {render} from './render.mjs';
const $=id=>document.getElementById(id),request=(name,args)=>window.guides.request(name,args);
let project=null,selected=null,rows=[],past=[],future=[],generation=0,editVersion=0,busy=false,draftTimer=null;
window.guidesDispose=()=>{clearTimeout(draftTimer);};
window.guidesDirty=false;
window.guidesRender=async({step,asset})=>(await render(step,asset)).toDataURL('image/png');
const clone=value=>JSON.parse(JSON.stringify(value));
const step=()=>project?.guide.steps.find(s=>s.id===selected);
function message(error=''){$('message').textContent=error.message||error;}
function state(label){$('save-state').textContent=label;}
function changed(){window.guidesDirty=true;editVersion++;state('Unsaved');request('dirty').catch(message);clearTimeout(draftTimer);draftTimer=setTimeout(()=>{if(project&&!busy&&window.guidesDirty)request('draft',project).catch(error=>message('Recovery draft failed. Save the guide now: '+error.message));},750);}
const historySnapshot=()=>({...project,guide:clone(project.guide),assets:{...project.assets}});
function remember(){past.push(historySnapshot());if(past.length>20)past.shift();future=[];}
function mutation(fn){if(busy)return;remember();fn();changed();draw();}
async function run(fn){if(busy)return;busy=true;message();document.querySelectorAll('button').forEach(b=>b.disabled=true);try{return await fn();}catch(error){message(error);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function accept(result){project=result.project;window.guidesDirty=result.saveState!=='saved';state(result.saveState==='saved'?'Saved':result.saveState==='failed'?'Failed to save':'Unsaved');selected=project?.guide.steps[0]?.id||null;past=[];future=[];message(result.error);draw();}
async function list(){rows=await request('list');drawLibrary();}
function drawLibrary(){const target=$('guide-list');target.replaceChildren();const query=$('search').value.toLowerCase();for(const row of rows.filter(r=>(r.title+' '+r.description).toLowerCase().includes(query))){const button=document.createElement('button');button.className='guide-card';button.disabled=!!row.invalid;const title=document.createElement('strong');title.textContent=row.title;const detail=document.createElement('span');detail.textContent=`${row.steps} steps`;button.append(title,detail);button.onclick=()=>run(async()=>accept(await request('open',row.id)));target.append(button);}if(!target.childElementCount)target.textContent='No matching guides. Create a guide to begin.';}
function draw(){
  $('library').hidden=!!project;$('editor').hidden=!project;$('privacy').hidden=true;
  if(!project){list().catch(message);return;}
  $('title').value=project.guide.title;$('description').value=project.guide.description;
  $('steps').replaceChildren();for(const [i,s] of project.guide.steps.entries()){const li=document.createElement('li'),b=document.createElement('button');b.textContent=`${i+1}. ${s.instruction||'Untitled step'}`;b.setAttribute('aria-current',String(s.id===selected));b.onclick=()=>{selected=s.id;draw();};li.append(b);$('steps').append(li);}
  const current=step();$('step-editor').hidden=!current;if(!current)return;
  $('instruction').value=current.instruction;$('notes').value=current.notes;drawImage().catch(message);
}
async function drawImage(){const token=++generation,s=step(),canvas=$('screenshot');if(!s?.asset){canvas.hidden=true;$('screenshot-status').textContent='No screenshot. Choose Replace screenshot to add one.';return;}const image=await render(s,project.assets[s.asset],{original:true});if(token!==generation)return;canvas.hidden=false;canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);if(s.crop){const c=s.crop,ctx=canvas.getContext('2d');ctx.strokeStyle='#dc7130';ctx.lineWidth=3;ctx.strokeRect(c.x*canvas.width,c.y*canvas.height,c.width*canvas.width,c.height*canvas.height);}$('screenshot-status').textContent=s.crop?'Crop shown in orange. Exports use the cropped region.':'Preview includes opaque redactions. Editable projects still retain the original screenshot.';}
for(const field of ['title','description','instruction','notes'])$(field).addEventListener('input',()=>{if(busy)return;const obj=['title','description'].includes(field)?project.guide:step();if(!obj)return;remember();obj[field]=$(field).value;changed();if(field==='instruction'){const button=$('steps').querySelector('[aria-current=true]');if(button)button.textContent=`${project.guide.steps.indexOf(obj)+1}. ${obj.instruction||'Untitled step'}`;}});
$('search').oninput=drawLibrary;
$('new').onclick=()=>run(async()=>accept(await request('new')));
$('import').onclick=()=>run(async()=>accept(await request('import')));
$('save').onclick=()=>run(async()=>{const version=editVersion;state('Saving');try{const result=await request('save',clone(project));if(editVersion===version){window.guidesDirty=false;state('Saved');message(result.error);}else state('Unsaved');}catch(error){state('Failed to save');throw error;}});
$('back').onclick=$('library-nav').onclick=()=>run(async()=>{if(window.guidesDirty)throw Error('Save your guide before returning to the library.');project=null;selected=null;draw();});
$('privacy-nav').onclick=()=>{$('privacy').hidden=!$('privacy').hidden;};
$('duplicate-guide').onclick=()=>run(async()=>{await request('duplicate');message('Saved copy added to your library.');});
$('delete-guide').onclick=()=>run(async()=>accept(await request('delete')));
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
$('export').onclick=()=>run(async()=>{if(window.guidesDirty)throw Error('Save your changes before exporting.');const result=await request('export',$('export-format').value);if(result.saved)message('Export saved. Open it independently and review sensitive information before sharing.');});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('save').click();}});
await run(async()=>{accept(await request('state'));await list();});
