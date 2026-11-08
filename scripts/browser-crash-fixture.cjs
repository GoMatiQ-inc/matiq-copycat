const path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {capture}=require('@matiq-solutions/sdk/fixture-lifecycle.cjs');
function crashHandlers(bundle){return bundle?execFileSync('/bin/ps',['-axo','pid=,comm='],{encoding:'utf8',timeout:5000}).split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(.+)$/.exec(line);return m&&m[2].startsWith(bundle+'/')&&path.basename(m[2]).endsWith('crashpad_handler')?[Number(m[1])]:[];}):[];}
function captureOwnedCrashHelpers({bundle,baseline,known=[]}){
 const result=[];
  if(process.platform!=='darwin'||!bundle)return result;
  const peers=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',String(process.pid),'-U'],{encoding:'utf8',timeout:5000}).split('\n').slice(1).map(line=>line.trim().split(/\s+/).at(-1)?.replace(/^->/,''));
  for(const pid of crashHandlers(bundle).filter(pid=>!baseline.includes(pid)&&!known.some(row=>row.pid===pid))){
   let sockets;try{sockets=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-U'],{encoding:'utf8',timeout:5000});}catch(error){if(error.status===1){try{process.kill(pid,0);}catch(gone){if(gone.code==='ESRCH')continue;} }throw error;}
   assert.ok(sockets.split('\n').slice(1).some(line=>{const fields=line.trim().split(/\s+/);return fields[3]?.startsWith('2')&&peers.includes(fields[5]);}),'A new browser crash helper has no owned parent stderr link. Leave it untouched and inspect ownership: '+pid);
   const row=capture({pid});row.identity=execFileSync('/bin/ps',['-p',String(pid),'-o','uid=,lstart=,comm='],{encoding:'utf8',timeout:5000}).trim();result.push(row);
  }
  return result;
}
module.exports={crashHandlers,captureOwnedCrashHelpers};
