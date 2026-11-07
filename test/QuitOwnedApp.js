ObjC.import('AppKit');
function run(args){
 const pid=Number(args[0]);if(!Number.isSafeInteger(pid)||pid<1||!args[1])throw Error('Supply the positively identified owned app PID and bundle path.');
 const application=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
 const files=$.NSFileManager.defaultManager,actual=files.attributesOfItemAtPathError(application.bundleURL.path,null),expected=files.attributesOfItemAtPathError(args[1],null);
 const same=key=>expected.objectForKey(key).isEqualToNumber(actual.objectForKey(key));
 if(!same('NSFileSystemNumber')||!same('NSFileSystemFileNumber'))throw Error('The app identity changed; preserve it and inspect before retrying cleanup.');
 if(!application.terminate)throw Error('The owned app refused its normal quit request.');
 const deadline=Date.now()+15000;while(!application.isTerminated&&Date.now()<deadline)$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
 if(!application.isTerminated)throw Error('The owned app did not finish normal quit. Inspect its pending work before cleanup.');
 return 'Owned application exited normally.';
}
