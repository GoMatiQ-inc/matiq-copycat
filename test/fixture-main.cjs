try{require('../scripts/native-test-isolation.cjs').assertNativeTestIsolation();}catch(error){console.error(error.message);process.exit(1);}
// Linux fixture models granted permissions only; macOS qualification always uses the real helper.
if(process.platform!=='darwin')require('../src/desktop.cjs').permissions=async()=>({screen:true,accessibility:true});
const {launch}=require('@matiq-solutions/runtime/standalone.cjs');
launch({root:process.argv[2],profile:process.argv[3]}).then(({instance})=>{global.fixtureInstance=instance;}).catch(error=>{console.error(error.message);process.exit(1);});
