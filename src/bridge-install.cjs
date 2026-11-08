const fs=require('node:fs/promises'),path=require('node:path');
const {app}=require('electron');
const P=require('./project.cjs');
const identity=require('../extension/identities.json');
const protocol=1;
async function install({host,browser}){
 const bridgeVersion=host.manifest.version;
 if(process.platform!=='darwin')throw Error('Native bridge installation is currently implemented for macOS only. This platform is unqualified.');
 const browserPaths={chrome:['Google','Chrome','NativeMessagingHosts'],edge:['Microsoft Edge','NativeMessagingHosts'],firefox:['Mozilla','NativeMessagingHosts']};
 if(!Object.hasOwn(browserPaths,browser))throw Error('Choose Chrome, Edge or Firefox for bridge setup.');
 const base=path.join(app.getPath('appData'),'MatiQ Solutions','Guides Bridge');await fs.mkdir(base,{recursive:true,mode:0o700});
 const registryFile=path.join(base,'registry.json'),unlock=await P.lock(registryFile);
 try{
  let registry={protocol,versions:{},consumers:{},manifests:{}};
  try{registry=JSON.parse(await fs.readFile(registryFile,'utf8'));if(registry.protocol!==protocol||!registry.versions||!registry.consumers||!registry.manifests)throw Error('The installed bridge registry uses a different protocol. Update compatible consumers together; do not replace their registrations.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const bundled=path.join(host.resourceDir,'native','guides-bridge');let source=bundled;
  try{await fs.access(source);}catch(error){if(error.code!=='ENOENT')throw error;source=path.join(process.resourcesPath,'native','guides-bridge');}
  const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('The packaged native bridge is missing or unsafe. Reinstall the approved application.');
  const bytes=await fs.readFile(source),digest=P.hash(bytes);
  if(registry.versions[bridgeVersion]&&registry.versions[bridgeVersion].sha256!==digest)throw Error('This bridge version has different bytes from its existing installation. Use an immutable newer bridge release; existing consumers have been preserved.');
  const versionRoot=path.join(base,'versions',bridgeVersion),destination=path.join(versionRoot,'guides-bridge');await fs.mkdir(versionRoot,{recursive:true,mode:0o700});
  try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o755});}catch(error){if(error.code!=='EEXIST')throw error;const existing=await fs.lstat(destination);if(!existing.isFile()||existing.isSymbolicLink()||P.hash(await fs.readFile(destination))!==digest)throw Error('The installed bridge binary has changed. Preserve it and inspect its provenance before retrying.');}
  registry.versions[bridgeVersion]={path:destination,sha256:digest};
  const chosen=Object.keys(registry.versions).sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;})[0];
  const selected=registry.versions[chosen];if(!selected||!path.isAbsolute(selected.path)||!selected.path.startsWith(path.join(base,'versions')+path.sep)||P.hash(await fs.readFile(selected.path))!==selected.sha256)throw Error('The shared bridge inventory failed validation. Existing registrations have been preserved.');
  const manifests=Object.keys(registry.manifests);const requested=path.join(app.getPath('appData'),...browserPaths[browser],identity.nativeHost+'.json');if(!manifests.includes(requested))manifests.push(requested);
  for(const file of manifests){
    const allowedPaths=Object.entries(browserPaths).map(([name,parts])=>({name,path:path.join(app.getPath('appData'),...parts,identity.nativeHost+'.json')}));const match=allowedPaths.find(item=>item.path===file);if(!match)throw Error('Bridge registry contains an unknown destination. Inspect it before retrying.');
    const manifest={name:identity.nativeHost,description:'MatiQ Copycat local workflow capture bridge',path:selected.path,type:'stdio',...(match.name==='firefox'?{allowed_extensions:[identity.firefoxId]}:{allowed_origins:[`chrome-extension://${identity.chromiumId}/`]})};
    const content=JSON.stringify(manifest,null,2)+'\n',expected=P.hash(Buffer.from(content));
    try{const existing=await fs.readFile(file),actual=P.hash(existing);if(actual!==expected&&(!registry.manifests[file]||actual!==registry.manifests[file]))throw Error('A native-host registration changed outside Copycat. Preserve it and review its owner before retrying setup.');}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await P.atomicBytes(file,content);registry.manifests[file]=expected;
  }
  registry.consumers[app.getName()==='MatiQ Solutions'?'suite':'standalone']={toolVersion:host.manifest.version,bridgeVersion,protocol,resourceDir:host.resourceDir};
  await P.atomicBytes(registryFile,JSON.stringify(registry,null,2)+'\n');
  return {installed:true,browser,bridgeVersion:chosen,protocol};
 }finally{await unlock();}
}
module.exports={install};
