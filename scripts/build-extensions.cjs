const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
async function main(){const root=path.join(__dirname,'..'),identity=require('../extension/identities.json'),version=require('../extension/version.json').version,output=path.join(root,'extensions-dist');await fs.mkdir(output,{recursive:true});
 for(const browser of ['chrome','edge','firefox']){
  const directory=path.join(output,browser);await fs.rm(directory,{recursive:true,force:true});await fs.mkdir(directory,{recursive:true});
  for(const file of ['background.js','content.js','popup.html','popup.css','popup.js'])await fs.copyFile(path.join(root,'extension/shared',file),path.join(directory,file));
  await fs.copyFile(path.join(root,'LICENSE'),path.join(directory,'LICENSE'));
  await fs.writeFile(path.join(directory,'identity.js'),'globalThis.GUIDES_IDENTITY='+JSON.stringify(identity)+';\n');
  const manifest={manifest_version:3,name:'MatiQ Guides',version,description:'Capture a selected browser workflow into a local editable MatiQ guide.',permissions:['activeTab','scripting','storage','nativeMessaging'],action:{default_title:'MatiQ Guides capture',default_popup:'popup.html'},content_security_policy:{extension_pages:"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' data:; object-src 'none'; base-uri 'none'"}};
  if(browser==='firefox'){manifest.background={scripts:['identity.js','background.js']};manifest.browser_specific_settings={gecko:{id:identity.firefoxId,strict_min_version:'140.0',data_collection_permissions:{required:['browsingActivity','websiteActivity','websiteContent']}}};}
  else{manifest.key=identity.chromiumKey;manifest.minimum_chrome_version='128';manifest.background={service_worker:'worker.js'};await fs.writeFile(path.join(directory,'worker.js'),"importScripts('identity.js','background.js');\n");}
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  execFileSync('python3',['-c',`import pathlib,sys,zipfile
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for file in sorted(source.iterdir()):
  info=zipfile.ZipInfo(file.name,(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,file.read_bytes())
`,directory,path.join(output,`matiq-guides-${browser}-${version}.zip`)],{stdio:'inherit',timeout:30000});
 }
 console.log('Built shared-source Chrome, Edge and unsigned Firefox developer packages. No store distribution or browser qualification is implied.');}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
