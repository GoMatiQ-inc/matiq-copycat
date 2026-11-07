const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),yaml=require('js-yaml'),assert=require('node:assert/strict'),{execFileSync,spawnSync}=require('node:child_process');
async function main(){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Verify the release on the authorized Apple Silicon Mac.');
 if(!process.env.APPLE_TEAM_ID)throw Error('Supply the expected company signing team from the existing release credentials.');
 const root=path.join(__dirname,'..'),output=path.join(root,'dist'),version=require('../package.json').version;
 const run=(program,args)=>execFileSync(program,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']});
 function signature(file){
  run('/usr/bin/codesign',['--verify','--strict','--verbose=2',file]);
  const details=spawnSync('/usr/bin/codesign',['-d','--verbose=4',file],{encoding:'utf8',timeout:30000});
  assert.equal(details.status,0,'Read the candidate signature before releasing.');
  assert.ok(details.stderr.includes('TeamIdentifier='+process.env.APPLE_TEAM_ID),'Candidate identity differs from the expected company team.');
  assert.match(details.stderr,/flags=.*\(runtime\)/,'Keep hardened runtime enabled.');
  const entitlements=run('/usr/bin/codesign',['-d','--entitlements',':-',file]);
  for(const key of ['com.apple.security.cs.disable-library-validation','com.apple.security.get-task-allow']){
   const tail=entitlements.split('<key>'+key+'</key>')[1];assert.ok(!tail||!/^\s*<true\s*\/>/.test(tail),'Remove unsafe release entitlement '+key);
  }
 }
 async function application(bundle){
  run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',bundle]);signature(bundle);
  for(const helper of ['guides-bridge','guides-capture'])signature(path.join(bundle,'Contents/Resources/native',helper));
  run('/usr/bin/xcrun',['stapler','validate','-q',bundle]);run('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',bundle]);
  const plist=path.join(bundle,'Contents/Info.plist');
  assert.equal(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',plist]).trim(),'com.matiq.guides');
  assert.equal(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',plist]).trim(),version);
 }
 const bundle=path.join(output,'mac-arm64/MatiQ Guides.app');await application(bundle);
 const zip='MatiQ-Guides-'+version+'-mac-arm64.zip',dmg='MatiQ-Guides-'+version+'-mac-arm64.dmg',stage=await fs.mkdtemp(path.join(os.tmpdir(),'guides-verify-zip-'));
 try{run('/usr/bin/ditto',['-x','-k',path.join(output,zip),stage]);await application(path.join(stage,'MatiQ Guides.app'));}finally{await fs.rm(stage,{recursive:true,force:true});}
 run('/usr/bin/codesign',['--verify','--strict',path.join(output,dmg)]);
 run('/usr/bin/xcrun',['stapler','validate','-q',path.join(output,dmg)]);
 run('/usr/sbin/spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=2',path.join(output,dmg)]);
 const metadata=yaml.load(await fs.readFile(path.join(output,'latest-mac.yml'),'utf8'));assert.equal(metadata.version,version);require('../src/standalone-updates.cjs').releaseSummary(metadata);
 for(const name of [zip,dmg]){const matches=metadata.files.filter(entry=>entry.url===name);assert.equal(matches.length,1);const bytes=await fs.readFile(path.join(output,name));assert.equal(matches[0].sha512,crypto.createHash('sha512').update(bytes).digest('base64'));assert.equal(matches[0].size,bytes.length);}
 const artifacts={};
 for(const name of [zip,dmg]){const bytes=await fs.readFile(path.join(output,name));artifacts[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
 const proof={schema:1,product:'com.matiq.guides',version,arch:process.arch,macOS:run('/usr/bin/sw_vers',['-productVersion']).trim(),commit:run('git',['-C',root,'rev-parse','HEAD']).trim(),sdk:'0.1.3',electron:'45.2.3',artifacts,checks:['strict-deep-signature','company-team','native-helper-signatures','hardened-runtime','library-validation','no-debug-entitlement','stapled-ticket','gatekeeper','extracted-zip-signatures','disk-image-signature-ticket-gatekeeper','final-update-hashes'],qualification:'signed candidate integrity; installed workflows and release/update acceptance are separate'};
 await fs.writeFile(path.join(output,'mac-signature.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('PASS: candidate company signatures, native helpers, notarization/stapling, Gatekeeper and extracted ZIP integrity.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
