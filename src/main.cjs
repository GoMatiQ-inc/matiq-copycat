const {app}=require('electron'),path=require('node:path');
// Preserve the existing standalone profile and explicit test/user-selected profiles across the product rename.
const profile=app.commandLine.getSwitchValue('user-data-dir')||path.join(app.getPath('appData'),'MatiQ Guides');
require('./standalone-updates.cjs').enable();
require('@matiq-solutions/runtime/standalone.cjs').launch({root:path.join(__dirname,'..'),profile}).catch(error=>{require('electron').dialog.showErrorBox('Could not start',error.message);require('electron').app.quit();});
