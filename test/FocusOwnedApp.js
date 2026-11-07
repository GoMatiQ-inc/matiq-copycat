ObjC.import('AppKit');
function run(args){
 const pid=Number(args[0]);if(!Number.isSafeInteger(pid)||pid<1||!args[1])throw Error('Supply the positively identified owned browser PID and bundle path.');
 const application=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
 const files=$.NSFileManager.defaultManager,actual=files.attributesOfItemAtPathError(application.bundleURL.path,null),expected=files.attributesOfItemAtPathError(args[1],null);
 const same=key=>expected.objectForKey(key).isEqualToNumber(actual.objectForKey(key));
 if(!same('NSFileSystemNumber')||!same('NSFileSystemFileNumber'))throw Error('The browser identity changed; preserve it and inspect before requesting focus.');
 if(!application.activateWithOptions(0))throw Error('macOS refused activation of the owned browser. Restore its test window before retrying.');
 const deadline=Date.now()+5000;while(!application.isActive&&Date.now()<deadline)$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
 if(!application.isActive)throw Error('The owned browser did not become the active macOS application. Check foreground contention before retrying qualification.');
 return 'Owned browser is active in macOS.';
}
