require('./standalone-updates.cjs').enable();
require('@matiq-solutions/runtime/standalone.cjs').launch({root:require('node:path').join(__dirname,'..')}).catch(error=>{require('electron').dialog.showErrorBox('Could not start',error.message);require('electron').app.quit();});
