#!/usr/bin/env python3
"""Real macOS selected-window capture fixture. No user-window content is retained."""
import base64, hashlib, json, os, platform, queue, signal, subprocess, sys, threading, time
from pathlib import Path

root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
subprocess.run(['node','-e',"require(process.argv[1]).assertNativeTestIsolation()",str(root/'scripts/native-test-isolation.cjs')],check=True)
binary=root/'native/guides-capture'
fixture=Path(os.environ['GUIDES_NATIVE_FIXTURE'])
children=[]
def watchdog(signum,frame): raise TimeoutError('Native capture fixture exceeded 60 seconds; inspect cleanup evidence.')
signal.signal(signal.SIGALRM,watchdog);signal.alarm(60)
def launch(args):
 p=subprocess.Popen([str(x) for x in args],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 children.append(p);events=queue.Queue()
 def read():
  for line in p.stdout:
   try: events.put(json.loads(line))
   except Exception as error: events.put({'type':'invalid','reason':str(error)})
 threading.Thread(target=read,daemon=True).start()
 return p,events
def next_type(events,kind,seconds=10):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:e=events.get(timeout=max(.01,end-time.monotonic()))
  except queue.Empty:raise TimeoutError('The controlled fixture did not emit '+kind)
  if e.get('type')=='issue': raise AssertionError(e.get('reason'))
  if e.get('type')==kind:return e
 raise TimeoutError('Expected native event: '+kind)
def write(p,line):p.stdin.write((line+'\n').encode());p.stdin.flush()
def stop(p):
 if p.poll() is None:
  try:write(p,'stop')
  except BrokenPipeError:pass
  try:p.wait(timeout=6)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=3);raise AssertionError('Owned helper required forced cleanup.')
proof={}
try:
 permissions=json.loads(subprocess.check_output([binary,'probe'],timeout=5))
 assert permissions['screen'] and permissions['accessibility'],'Authorize the controlled native test in Screen Recording and Accessibility before running it.'
 app,events=launch([fixture]);ready=next_type(events,'ready')
 # Inspect only the fixture identity from the list; never log user-window titles.
 listing=json.loads(subprocess.check_output([binary,'list'],timeout=10))
 chosen=[w for w in listing['windows'] if w['id']==ready['window']]
 assert len(chosen)==1 and chosen[0]['title']=='MatiQ Copycat Native Fixture'
 wrong=subprocess.run([binary,'record',str(ready['window']),str(ready['pid']+1)],capture_output=True,timeout=10)
 assert wrong.returncode!=0 and json.loads(wrong.stdout)['type']=='issue','A window identity mismatch must fail before hooks start.'
 capture,steps=launch([binary,'record',ready['window'],ready['pid']]);next_type(steps,'ready')
 time.sleep(.3);write(app,'click');sent=next_type(events,'click-sent');assert sent['focused'],'Fixture activation failed.';next_type(events,'clicked');first=next_type(steps,'step')
 assert first['source']=='desktop' and first['action']=='click'
 assert first.get('label')=='Open settings',first.get('control')
 assert 'CONTROLLED-SECRET' not in json.dumps(first)
 assert first['image']['mediaType']=='image/jpeg'
 image=base64.b64decode(first['image']['data'],validate=True)
 assert image[:3]==bytes.fromhex('ffd8ff') and len(image)<=700000
 target=first['target'];assert all(0<=target[k]<=1 for k in ['x','y','width','height'])
 assert abs(target['x']-50/560)<.025 and abs(target['width']-180/560)<.025
 assert .15<target['y']<.3,'Target is not aligned to the selected window screenshot.'
 write(app,'other');other=next_type(events,'clicked');assert other['label']=='Other action'
 time.sleep(.5);assert steps.empty(),'A click in another window escaped the selected-window scope.'
 write(app,'restore');next_type(events,'restored')
 write(app,'move');next_type(events,'moved');time.sleep(.3)
 write(app,'click');moved=next_type(steps,'step')
 for key in target:assert abs(moved['target'][key]-target[key])<.025,'Window movement changed normalized target alignment.'
 stop(capture);assert capture.poll()==0
 write(app,'click');time.sleep(.3)
 # Resume explicitly starts a new owned monitor, using the same selected window.
 capture2,steps2=launch([binary,'record',ready['window'],ready['pid']]);next_type(steps2,'ready')
 write(app,'click');resumed=next_type(steps2,'step')
 assert resumed.get('label')=='Open settings'
 capture2.stdin.close();capture2.wait(timeout=5);assert capture2.poll()==0
 capture2,steps2=launch([binary,'record',ready['window'],ready['pid']]);next_type(steps2,'ready')
 write(app,'quit');app.wait(timeout=5)
 issue=steps2.get(timeout=5)
 assert issue['type']=='issue' and ('closed' in issue['reason'].lower() or 'screen' in issue['reason'].lower()),issue
 capture2.wait(timeout=5)
 proof={'result':'passed','os':platform.mac_ver()[0],'architecture':platform.machine(),'helperSHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'sourceSHA256':hashlib.sha256((root/'native/Capture.swift').read_bytes()).hexdigest(),'imageSHA256':hashlib.sha256(image).hexdigest(),'imageBytes':len(image),'controlLabel':'Open settings','checks':['actual ScreenCaptureKit JPEG','actual Accessibility button title without field values','normalized target alignment','window movement','selected process identity mismatch rejected','other same-app window excluded','parent pipe closure stops hooks','mouse hook stop and explicit restart','selected application closure visibly interrupts'],'qualification':'unsigned component fixture; not packaged standalone or suite'}
finally:
 signal.alarm(0)
 errors=[]
 for child in reversed(children):
  try:stop(child)
  except Exception as e:errors.append(str(e))
  try:os.kill(child.pid,0);errors.append('Owned PID remains: '+str(child.pid))
  except ProcessLookupError:pass
 if errors:raise AssertionError('; '.join(errors))
if proof:
 proof['ownedProcessCleanup']='verified absent'
 destination=root/'.validation/desktop-component-proof.json';destination.parent.mkdir(exist_ok=True);destination.write_text(json.dumps(proof,indent=2)+'\n')
 print(json.dumps(proof,indent=2))
