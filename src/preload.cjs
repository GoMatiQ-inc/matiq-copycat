const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('guides',{request:(name,args)=>ipcRenderer.invoke('com.matiq.guides:request',name,args),subscribe:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('com.matiq.guides:state',listener);return ()=>ipcRenderer.removeListener('com.matiq.guides:state',listener);}});
