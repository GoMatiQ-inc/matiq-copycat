const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('guides',{request:(name,args)=>ipcRenderer.invoke('com.matiq.guides:request',name,args)});
