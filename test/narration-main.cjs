require('../scripts/native-test-isolation.cjs').assertNativeTestIsolation();
require('@matiq-solutions/runtime/standalone.cjs').launch({root:process.env.COPYCAT_TEST_ROOT,profile:process.env.COPYCAT_TEST_PROFILE}).catch(error=>{console.error(error.message);process.exit(1);});
