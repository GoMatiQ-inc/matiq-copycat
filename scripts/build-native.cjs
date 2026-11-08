const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
if(process.platform!=='darwin')throw Error('Build the native macOS helpers on the authorized Mac release host.');
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'guides-native-build-'));
try{
 for(const [source,output] of [['Bridge.swift','guides-bridge'],['Capture.swift','guides-capture']])execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2','-module-cache-path',cache,path.join(__dirname,'../native/'+source),'-o',path.join(__dirname,'../native/'+output)],{stdio:'inherit',timeout:120000});
}finally{fs.rmSync(cache,{recursive:true,force:true});}
