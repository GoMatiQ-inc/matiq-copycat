const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),crypto=require('node:crypto');
const yaml=require('js-yaml');
const {buildBlockMap}=require('app-builder-lib/out/targets/blockmap/blockmap');
const run=promisify(execFile);
module.exports=async function notarizeContainer(){
 const version=require('../package.json').version,folder=path.join(__dirname,'../dist'),name='MatiQ-Guides-'+version+'-mac-arm64.dmg',file=path.join(folder,name);
 if(!process.env.APPLE_KEYCHAIN_PROFILE||!process.env.APPLE_KEYCHAIN)throw Error('Notarize the disk image inside the qualified SDK credential profile.');
 const result=await run('/usr/bin/xcrun',['notarytool','submit',file,'--keychain-profile',process.env.APPLE_KEYCHAIN_PROFILE,'--keychain',process.env.APPLE_KEYCHAIN,'--wait','--output-format','json'],{timeout:1200000,maxBuffer:256*1024});
 const ticket=JSON.parse(result.stdout);
 if(ticket.status!=='Accepted')throw Error('The disk image was not accepted by Apple. Preserve the submission ID and inspect its protected notarization log before retrying.');
 await run('/usr/bin/xcrun',['stapler','staple',file],{timeout:120000,maxBuffer:256*1024});
 await run('/usr/bin/xcrun',['stapler','validate','-q',file],{timeout:120000,maxBuffer:256*1024});
 // The final container bytes, not the pre-staple image, own the update hashes.
 await buildBlockMap(file,'gzip',file+'.blockmap');
 const bytes=await fs.readFile(file),sha512=crypto.createHash('sha512').update(bytes).digest('base64');
 const metadataFile=path.join(folder,'latest-mac.yml'),metadata=yaml.load(await fs.readFile(metadataFile,'utf8'));
 const entries=metadata.files?.filter(entry=>entry.url===name);
 if(metadata.version!==version||entries?.length!==1)throw Error('The generated update metadata does not identify exactly this candidate disk image.');
 entries[0].sha512=sha512;entries[0].size=bytes.length;
 if(metadata.path===name){metadata.sha512=sha512;if(metadata.size!==undefined)metadata.size=bytes.length;}
 await fs.writeFile(metadataFile,yaml.dump(metadata));
 await fs.writeFile(path.join(folder,'container-notary.json'),JSON.stringify({schema:1,version,submissionId:ticket.id,status:ticket.status,file:name,sha512,bytes:bytes.length},null,2)+'\n');
 console.log('PASS: signed disk image notarized/stapled; final blockmap and update hashes regenerated.');
};
