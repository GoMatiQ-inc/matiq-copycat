(() => {
 if(globalThis.__matiqGuidesCapture)return;
 const api=globalThis.browser||chrome,doc=crypto.randomUUID();let active=false,revision=0,controller=null,observer=null,timer=null,badge=null,previousHref=location.href,framesWarned=false;
 const targets=new Map();
 const viewport=()=>({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY,scale:visualViewport?.scale||1,dpr:devicePixelRatio});
 function rectangle(element){if(!element?.isConnected)return null;const r=element.getBoundingClientRect(),x=Math.max(0,r.left),y=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);return right>x&&bottom>y?{x:x/innerWidth,y:y/innerHeight,width:(right-x)/innerWidth,height:(bottom-y)/innerHeight}:null;}
 function context(id){return {doc,revision,viewport:viewport(),target:id?rectangle(targets.get(id)):null,origin:location.origin};}
 function send(value){return api.runtime.sendMessage({type:'capture',...value}).then(result=>{if(result?.error)throw Error(result.error);return result;}).catch(error=>{stop();const node=document.createElement('div');node.id='matiq-guides-capture-error';node.textContent='MatiQ Guides capture stopped. Open the extension to reconnect and review pending steps.';node.setAttribute('role','alert');node.style.cssText='position:fixed;z-index:2147483647;top:0;left:0;background:#fff0de;color:#3b2200;padding:14px;font:14px sans-serif';document.documentElement.append(node);throw error;});}
 function changed(){revision++;clearTimeout(timer);timer=setTimeout(()=>{if(active)send({command:'baseline',context:context()}).catch(()=>{});},250);if(location.href!==previousHref){previousHref=location.href;send({command:'navigation',context:context()}).catch(()=>{});}}
 function role(element){if(element.tagName==='INPUT'&&['button','submit','reset'].includes(element.type))return 'button';if(element.tagName==='A')return 'link';if(element.tagName==='SELECT')return 'dropdown';if(element.type==='checkbox')return 'checkbox';if(element.type==='radio')return 'radio button';if(element.tagName==='INPUT'||element.tagName==='TEXTAREA'||element.isContentEditable)return 'field';return element.getAttribute('role')==='menuitem'?'menu item':'button';}
 function label(element){if(['INPUT','TEXTAREA','SELECT'].includes(element.tagName)||element.isContentEditable)return '';return (element.getAttribute('aria-label')||element.innerText||'').trim().slice(0,100);}
 function action(e){
  if(!active||!e.isTrusted||e.button!==0||(e.type==='click'&&e.detail!==0))return;
  const element=e.target?.closest?.('button,a,input,textarea,select,[role="button"],[role="menuitem"],[role="checkbox"],[contenteditable="true"]');
  if(!element||element.disabled||badge?.contains(element))return;
  if(e.detail>1){send({command:'warning',reason:'A repeated click was grouped with its preceding click. Review double-click instructions manually.'}).catch(()=>{});return;}
  if(['password','hidden'].includes(element.type)||/password|secret|token|api.?key|credit|card|ssn|otp|one.?time/i.test((element.name||'')+' '+(element.autocomplete||''))){send({command:'warning',reason:'A sensitive field action was omitted. Review the screenshot and add a safe manual instruction if needed.'}).catch(()=>{});return;}
  if(['field','dropdown','checkbox','radio button'].includes(role(element)))return;
  const id=crypto.randomUUID();targets.set(id,element);while(targets.size>8)targets.delete(targets.keys().next().value);
  send({command:'action',event:{id,at:Date.now(),action:'click',control:role(element),label:label(element),navigationExpected:element.tagName==='A'},context:context(id)}).catch(()=>{});
 }
 function form(e){
  if(!active||!e.isTrusted)return;const element=e.target;if(!element?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
  if(['password','hidden','file'].includes(element.type)||/password|secret|token|api.?key|credit|card|ssn|otp|one.?time/i.test((element.name||'')+' '+(element.autocomplete||''))){send({command:'warning',reason:'A sensitive or unsupported form interaction was omitted. Add a safe manual instruction after recording.'}).catch(()=>{});return;}
  const id=crypto.randomUUID();targets.set(id,element);while(targets.size>8)targets.delete(targets.keys().next().value);
  send({command:'action',event:{id,at:Date.now(),action:element.tagName==='SELECT'?'select':['checkbox','radio'].includes(element.type)?'toggle':'fill',control:role(element),label:''},context:context(id)}).catch(()=>{});
 }
 function warnFrames(){if(!framesWarned&&document.querySelector('iframe,frame')){framesWarned=true;send({command:'warning',reason:'This page contains embedded frames. Only the top-level page is supported; actions inside frames will be missing.'}).catch(()=>{});}}
 function stop(){active=false;controller?.abort();controller=null;observer?.disconnect();observer=null;clearTimeout(timer);badge?.remove();badge=null;targets.clear();}
 function start(){
  stop();framesWarned=false;document.getElementById('matiq-guides-capture-error')?.remove();active=true;controller=new AbortController();const options={capture:true,signal:controller.signal};
  addEventListener('pagehide',stop,{signal:controller.signal});addEventListener('mousedown',action,options);addEventListener('click',action,options);addEventListener('change',form,options);addEventListener('scroll',changed,options);addEventListener('resize',changed,options);addEventListener('popstate',changed,options);addEventListener('hashchange',changed,options);visualViewport?.addEventListener('resize',changed,{signal:controller.signal});
  badge=document.createElement('div');badge.id='matiq-guides-recording';badge.style.cssText='position:fixed;z-index:2147483647;right:12px;top:12px';
  const shadow=badge.attachShadow({mode:'closed'}),label=document.createElement('span');label.textContent='● MatiQ Guides recording';label.style.cssText='display:block;padding:8px 12px;color:white;background:#8b241b;border-radius:6px;font:13px sans-serif';shadow.append(label);document.documentElement.append(badge);
  observer=new MutationObserver(records=>{if(!badge?.isConnected){send({command:'interrupted',reason:'The page removed the recording indicator. Capture paused; reopen the extension before continuing.'}).catch(()=>{});return;}if(records.some(record=>record.type==='childList'))warnFrames();if(records.some(record=>record.target!==badge))changed();});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
  warnFrames();
  return context();
 }
 api.runtime.onMessage.addListener((message,_sender,reply)=>{
  if(message?.type!=='guides-control')return;
  try{if(message.command==='start'){reply(start());return;}if(message.command==='stop'){stop();reply({stopped:true});return;}if(message.command==='context'){reply(context(message.id));return;}if(message.command==='indicator'){if(badge)badge.style.visibility=message.visible?'visible':'hidden';reply({done:true});return;}}catch{reply({error:'The selected page could not change capture state. Reopen it and reconnect.'});}
 });
 globalThis.__matiqGuidesCapture={stop};
})();
