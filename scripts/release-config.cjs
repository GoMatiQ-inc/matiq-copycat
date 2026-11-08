const path=require('node:path');
const {build,version}=require('../package.json'),manifest=require('../matiq-tool.json');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Build this candidate on the authorized Apple Silicon macOS release host.');
if(manifest.version!==version||manifest.runtime!=='electron-45.2.3')throw Error('Reconcile the app/tool version and qualified Electron runtime before signing.');
if(!process.env.CSC_NAME?.startsWith('Developer ID Application:')||!process.env.APPLE_ID||!process.env.APPLE_TEAM_ID||!process.env.APPLE_APP_SPECIFIC_PASSWORD)throw Error('Load the existing company Apple signing and notarization credentials through the protected release launcher.');
module.exports={...build,asar:true,forceCodeSigning:true,dmg:{...build.dmg,sign:true},mac:{...build.mac,target:['dmg','zip'],identity:process.env.CSC_NAME.slice('Developer ID Application:'.length).trim(),notarize:true,entitlements:path.join(__dirname,'../build/entitlements.mac.plist'),entitlementsInherit:path.join(__dirname,'../build/entitlements.mac.plist'),artifactName:'MatiQ-Copycat-${version}-mac-${arch}.${ext}'}};
