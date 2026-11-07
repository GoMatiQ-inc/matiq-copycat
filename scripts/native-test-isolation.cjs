const {execFileSync}=require('node:child_process');
function assertNativeTestIsolation(){
 if(process.platform!=='darwin')return;
 if(process.env.GUIDES_NATIVE_TEST_VM!=='tart')throw Error('macOS GUI tests require the authorized Tart guest and GUIDES_NATIVE_TEST_VM=tart. Active host desktops are prohibited; no test window was started.');
 let virtualized;try{virtualized=execFileSync('/usr/sbin/sysctl',['-n','kern.hv_vmm_present'],{encoding:'utf8',timeout:3000}).trim();}catch{throw Error('Cannot verify macOS test isolation. Check the Tart guest kernel before retrying; no test window was started.');}
 if(virtualized!=='1')throw Error('macOS GUI tests are blocked on physical hosts. Run this through the isolated Tart guest; no test window was started.');
}
module.exports={assertNativeTestIsolation};
