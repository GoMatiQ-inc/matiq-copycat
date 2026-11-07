import json,os,pathlib,socket,struct,subprocess,uuid,hmac,time,signal
def expired(_signal,_frame):raise TimeoutError('Native bridge fixture exceeded its 30-second parent deadline.')
signal.signal(signal.SIGALRM,expired);signal.alarm(30)
root=pathlib.Path.home()/'Library/Application Support/MatiQ Solutions/Guides Bridge'
created=not root.exists();root.mkdir(parents=True,exist_ok=True,mode=0o700)
assert root.is_dir() and not root.is_symlink() and root.stat().st_mode&0o077==0
record_path=root/'active.json';endpoint=root/('g-'+str(os.getpid())+'.sock')
assert not record_path.exists() and not endpoint.exists(),'An existing bridge owns this location. Close it before this isolated native fixture.'
nonce=str(uuid.uuid4());token=uuid.uuid4().hex+uuid.uuid4().hex
record={'v':1,'pid':os.getpid(),'nonce':nonce,'token':token,'socket':str(endpoint),'instance':'Native fixture'}
listener=socket.socket(socket.AF_UNIX);listener.settimeout(5);process=None;connection=None
repository=pathlib.Path(__file__).resolve().parents[1]
binary=repository/'native/guides-bridge'
identity=json.loads((repository/'extension/identities.json').read_text())
def receive(stream):
 def exact(size):
  data=b''
  while len(data)<size:
   chunk=stream.recv(size-len(data)) if isinstance(stream,socket.socket) else stream.read(size-len(data))
   assert chunk,'Connection ended unexpectedly';data+=chunk
  return data
 length=struct.unpack('<I',exact(4))[0];assert 0<length<=1048576;return json.loads(exact(length))
def encode(value):
 body=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode();return struct.pack('<I',len(body))+body
try:
 listener.bind(str(endpoint));os.chmod(endpoint,0o600);listener.listen(1)
 with os.fdopen(os.open(record_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as file:json.dump(record,file)
 origin='chrome-extension://'+identity['chromiumId']+'/'
 process=subprocess.Popen([str(binary),origin],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
 connection,_=listener.accept();connection.settimeout(5)
 auth=receive(connection);assert auth['v']==1 and auth['type']=='authenticate' and auth['origin']==origin and hmac.compare_digest(auth['token'],token)
 connection.sendall(encode({'v':1,'type':'ready','receiver':nonce,'instance':'Native fixture'}));assert receive(process.stdout)['type']=='ready'
 request={'v':1,'type':'status','requestId':'round-trip'};process.stdin.write(encode(request));process.stdin.flush();assert receive(connection)==request
 response={'v':1,'requestId':'round-trip','result':{'status':'Ready ✓'}};connection.sendall(encode(response));assert receive(process.stdout)==response
 process.stdin.write(struct.pack('<I',2*1024*1024));process.stdin.flush();assert receive(process.stdout)['type']=='error';assert process.wait(timeout=5)==1
 assert process.stderr.read()==b''
 print('PASS: actual macOS native helper authenticates, preserves framed Unicode round-trips, rejects oversized input visibly and exits.')
finally:
 if process and process.poll() is None:
  process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
 if process:assert process.poll() is not None
 if connection:connection.close()
 listener.close()
 if record_path.exists():
  assert json.loads(record_path.read_text())['nonce']==nonce;record_path.unlink()
 if endpoint.exists():endpoint.unlink()
 assert not endpoint.exists() and not record_path.exists()
 if created:root.rmdir()
 signal.alarm(0)
 print('PASS: owned native helper is absent; fixture socket and connection record were removed.')
