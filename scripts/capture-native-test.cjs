const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
if(process.platform!=='darwin')throw Error('Run the native capture fixture on the authorized macOS host.');
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'guides-capture-fixture-'));
try{
 const binary=require('./native-fixture.cjs').buildNativeFixture({root:path.join(__dirname,'..'),temporary:cache});
 execFileSync('/usr/bin/python3',[path.join(__dirname,'test-capture-native.py')],{stdio:'inherit',timeout:75000,env:{...process.env,GUIDES_NATIVE_FIXTURE:binary}});
}finally{fs.rmSync(cache,{recursive:true,force:true});}
