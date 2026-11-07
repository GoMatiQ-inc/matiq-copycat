require('../scripts/native-test-isolation.cjs').assertNativeTestIsolation();
const {launch}=require('@matiq-solutions/runtime/standalone.cjs');
launch({root:process.argv[2],profile:process.argv[3]}).then(({instance})=>{global.fixtureInstance=instance;}).catch(error=>{console.error(error.message);process.exit(1);});
