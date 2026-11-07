const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('tool',{request:(name,args)=>ipcRenderer.invoke('com.matiq.guides:request',name,args)});
