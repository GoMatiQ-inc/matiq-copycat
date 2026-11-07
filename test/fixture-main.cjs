const {launch}=require('@matiq-solutions/runtime/standalone.cjs');
launch({root:process.argv[2],profile:process.argv[3]}).catch(error=>{console.error(error.message);process.exit(1);});
