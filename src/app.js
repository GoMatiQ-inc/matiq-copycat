const text=document.querySelector('textarea'),status=document.querySelector('#status'),save=document.querySelector('#save');
text.disabled=true;save.disabled=true;
window.tool.request('load').then(value=>{text.value=value;text.disabled=false;save.disabled=false;}).catch(e=>status.textContent='Document could not be loaded. Reopen the tool before editing: '+e.message);
text.oninput=()=>status.textContent='Unsaved changes';
save.onclick=async()=>{save.disabled=true;const snapshot=text.value;try{await window.tool.request('save',snapshot);status.textContent=text.value===snapshot?'Saved on this device.':'Unsaved changes';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
