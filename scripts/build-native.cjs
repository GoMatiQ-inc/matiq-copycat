const {execFileSync}=require('node:child_process');
const path=require('node:path');
if(process.platform!=='darwin')throw Error('Build the native macOS bridge on the authorized Mac release host.');
execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2',path.join(__dirname,'../native/Bridge.swift'),'-o',path.join(__dirname,'../native/guides-bridge')],{stdio:'inherit',timeout:120000});
