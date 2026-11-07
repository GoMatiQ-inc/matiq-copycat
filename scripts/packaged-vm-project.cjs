const fs=require('node:fs/promises'),{createReadStream}=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
async function hash(file){const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex');}
async function main(){
 require('./native-test-isolation.cjs').assertNativeTestIsolation();if(process.platform!=='darwin')throw Error('Run signed project qualification inside the authorized Tart macOS guest.');
 const selected=process.env.GUIDES_QUALIFICATION_INPUT;if(!selected)throw Error('Stage the signed qualification inputs and set the GUIDES_QUALIFICATION_INPUT repository variable before running packaged VM checks.');
 const input=await fs.realpath(selected),base=path.dirname(input),manifest=JSON.parse(await fs.readFile(input,'utf8'));assert.equal(manifest.schema,1);assert.equal(manifest.sdk,'0.1.3');assert.equal(manifest.electron,'45.2.3');assert.match(manifest.toolSource,/^[a-f0-9]{40}$/);assert.ok(manifest.files&&Object.keys(manifest.files).length<=30);assert.ok(Object.values(manifest.files).every(file=>Number.isSafeInteger(file.bytes)&&file.bytes>=0)&&Object.values(manifest.files).reduce((sum,file)=>sum+file.bytes,0)<2*1024**3,'Qualification inputs exceed the bounded two-GiB payload.');
 async function asset(name){assert.ok(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)&&name!=='.'&&name!=='..','Qualification artifact names must be plain filenames.');const file=path.join(base,name),stat=await fs.lstat(file),expected=manifest.files[name];assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&expected,'Restage the missing or unsupported qualification artifact.');assert.ok(stat.size<2*1024**3&&stat.size===expected.bytes);assert.equal(await hash(file),expected.sha256,'Qualification artifact bytes changed; restore the verified input set.');return file;}
 const files={};for(const name of Object.keys(manifest.files))files[name]=await asset(name);
 for(const name of ['toolZip','package','signature','suiteZip','chromeZip'])assert.ok(files[manifest[name]],'Qualification manifest is missing '+name);
 const candidate=JSON.parse(await fs.readFile(files[manifest.signature],'utf8'));assert.equal(candidate.version,manifest.toolVersion);assert.equal(candidate.commit,manifest.toolSource);assert.equal(candidate.sdk,'0.1.3');assert.equal(candidate.electron,'45.2.3');assert.equal(manifest.files[manifest.toolZip].sha256,candidate.artifacts[manifest.toolZip].sha256);execFileSync('git',['cat-file','-e',manifest.toolSource+'^{commit}'],{stdio:'pipe',timeout:10000});
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'guides-packaged-vm-')));let passed=false;
 try{
  async function unpack(role,bundle){const archive=files[manifest[role]],target=path.join(temporary,role);await fs.mkdir(target);execFileSync('/usr/bin/python3',['-c',`import pathlib,zipfile,stat,posixpath,sys
with zipfile.ZipFile(sys.argv[1]) as archive:
 total=0
 for member in archive.infolist():
  name=member.filename;parts=pathlib.PurePosixPath(name).parts
  assert not name.startswith('/') and '..' not in parts and chr(92) not in name
  assert parts and parts[0] in [sys.argv[2],'__MACOSX']
  total+=member.file_size;assert total<3*1024**3
  if stat.S_ISLNK(member.external_attr>>16):
   link=archive.read(member).decode('utf-8');resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),link))
   assert not link.startswith('/') and resolved.split('/')[0]==sys.argv[2]
`,archive,bundle],{stdio:'pipe',timeout:30000});execFileSync('/usr/bin/ditto',['-x','-k',archive,target],{stdio:'pipe',timeout:120000});const app=path.join(target,bundle);execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe',timeout:120000});execFileSync('/usr/sbin/spctl',['--assess','--type','execute',app],{stdio:'pipe',timeout:120000});return app;}
  const standalone=await unpack('toolZip','MatiQ Guides.app'),suite=await unpack('suiteZip','MatiQ Solutions.app'),chrome=await unpack('chromeZip','Google Chrome.app');
  for(const [bundle,version]of [[standalone,manifest.toolVersion],[suite,manifest.suiteVersion],[chrome,manifest.chromeVersion]])assert.equal(execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(bundle,'Contents/Info.plist')],{encoding:'utf8',timeout:10000}).trim(),version);
  assert.equal(await hash(path.join(suite,'Contents/Resources/app.asar')),manifest.suiteArchiveSHA256,'The suite bytes must match the previously verified release.');
  const env={...process.env,GUIDES_EXECUTABLE_PATH:path.join(standalone,'Contents/MacOS/MatiQ Guides'),GUIDES_SUITE_EXECUTABLE_PATH:path.join(suite,'Contents/MacOS/MatiQ Solutions'),GUIDES_SUITE_PACKAGE:files[manifest.package],GUIDES_CANDIDATE_PROOF:files[manifest.signature],GUIDES_TEST_CHROME_BUNDLE:chrome,GUIDES_TEST_SAFE_DIAGNOSTICS:'1'};
  execFileSync(process.execPath,[path.join(__dirname,'packaged-project-test.cjs')],{env,stdio:'inherit',timeout:300000});const proof=JSON.parse(await fs.readFile(path.join(__dirname,'../.validation/packaged-project-proof.json'),'utf8'));assert.equal(proof.result,'passed');assert.equal(proof.sourceCommit,manifest.toolSource);assert.equal(proof.tool,manifest.toolVersion);assert.equal(proof.cleanup,'owned processes and listeners verified absent');passed=true;
  const result={...proof,inputManifestSHA256:await hash(input),suiteArchiveSHA256:manifest.suiteArchiveSHA256,chromeVersion:manifest.chromeVersion,isolation:'authorized Tart guest; physical-host GUI commands are blocked'};await fs.writeFile(path.join(process.env.RUNNER_TEMP||temporary,'matiq-guides-packaged-vm-proof.json'),JSON.stringify(result,null,2)+'\n');
 }finally{if(passed)await fs.rm(temporary,{recursive:true});else console.error('Packaged VM check failed. Preserve its extraction folder until owned-process/port cleanup is verified:',temporary);}
 console.log('PASS: real signed standalone/suite project and independent exports in the isolated Tart guest. Marketplace and capture remain separate gates.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
