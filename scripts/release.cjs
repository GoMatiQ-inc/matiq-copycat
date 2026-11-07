const path=require('node:path');
const {withMacKeychain}=require('@matiq-solutions/sdk/mac-keychain.cjs');
const {withNotaryProfile}=require('@matiq-solutions/sdk/notary-profile.cjs');
async function main(){
 const config=require('./release-config.cjs');
 require('./build-native.cjs');
 const {build,Platform,Arch}=require('electron-builder');
 await withMacKeychain(process.env,()=>withNotaryProfile(process.env,()=>build({projectDir:path.join(__dirname,'..'),targets:Platform.MAC.createTarget(['dmg','zip'],Arch.arm64),config,publish:'never'})),{requireInstaller:false});
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
