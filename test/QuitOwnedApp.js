ObjC.import('AppKit');
function run(args){
 const pid=Number(args[0]);if(!Number.isSafeInteger(pid)||pid<1||!args[1])throw Error('Supply the positively identified owned app PID and bundle path.');
 const application=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
 const files=$.NSFileManager.defaultManager,actual=files.attributesOfItemAtPathError(application.bundleURL.path,null),expected=files.attributesOfItemAtPathError(args[1],null);
 const same=key=>expected.objectForKey(key).isEqualToNumber(actual.objectForKey(key));
 if(!same('NSFileSystemNumber')||!same('NSFileSystemFileNumber'))throw Error('The app identity changed; preserve it and inspect before retrying cleanup.');
 if(args[2]){
  const process=Application('System Events').processes.whose({unixId:pid})()[0];
  function ready(elements,depth){if(depth>18)return false;for(const element of elements){if(element.role()==='AXButton'&&element.name()===args[2]&&element.enabled())return true;if(ready(element.uiElements(),depth+1))return true;}return false;}
  const readyDeadline=Date.now()+10000;let found=false;
  while(Date.now()<readyDeadline){if(process.windows().some(window=>ready(window.uiElements(),0))){found=true;break;}$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));}
  if(!found)throw Error('The owned workspace did not enable its expected control. Inspect startup before testing normal quit.');
 }
 if(!application.terminate)throw Error('The owned app refused its normal quit request.');
 const deadline=Date.now()+15000;while(!application.isTerminated&&Date.now()<deadline)$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
 if(!application.isTerminated)throw Error('The owned app did not finish normal quit. Inspect its pending work before cleanup.');
 return 'Owned application exited normally.';
}
