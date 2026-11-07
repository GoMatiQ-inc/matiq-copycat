const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
if(process.platform!=='darwin')throw Error('Run the native capture fixture on the authorized macOS host.');
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'guides-capture-fixture-'));
try{
 execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2','-module-cache-path',cache,path.join(__dirname,'../test/CaptureFixture.swift'),'-o',path.join(__dirname,'../native/GuidesNativeFixture')],{stdio:'inherit',timeout:120000});
 execFileSync('/usr/bin/python3',[path.join(__dirname,'test-capture-native.py')],{stdio:'inherit',timeout:75000});
}finally{fs.rmSync(cache,{recursive:true,force:true});fs.rmSync(path.join(__dirname,'../native/GuidesNativeFixture'),{force:true});}
