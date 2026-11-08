const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function buildNativeFixture({root,temporary}){
 const contents=path.join(temporary,'GuidesNativeFixture.app/Contents'),binary=path.join(contents,'MacOS/GuidesNativeFixture');fs.mkdirSync(path.dirname(binary),{recursive:true});
 fs.writeFileSync(path.join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.matiq.guides.fixture</string><key>CFBundleExecutable</key><string>GuidesNativeFixture</string><key>CFBundleName</key><string>GuidesNativeFixture</string><key>CFBundleVersion</key><string>1</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>');
 execFileSync('xcrun',['swiftc','-O','-target','arm64-apple-macos14.2','-module-cache-path',process.env.GUIDES_SWIFT_MODULE_CACHE||path.join(temporary,'modules'),path.join(root,'test/CaptureFixture.swift'),'-o',binary],{timeout:120000,stdio:'pipe'});return binary;
}
module.exports={buildNativeFixture};
