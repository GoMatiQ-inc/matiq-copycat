import AppKit
import ApplicationServices
func output(_ value: [String:Any]) { let data=try! JSONSerialization.data(withJSONObject:value);FileHandle.standardOutput.write(data+Data([10])) }
final class Actions: NSObject {
 @objc func pressed(_ sender: NSButton) { output(["type":"clicked","label":sender.title]) }
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let action=Actions()
var otherWindow: NSWindow?
let window=NSWindow(contentRect:NSRect(x:220,y:220,width:560,height:340),styleMask:[.titled,.closable],backing:.buffered,defer:false)
window.isReleasedWhenClosed=false
window.title="MatiQ Copycat Native Fixture"
let button=NSButton(title:"Open settings",target:action,action:#selector(Actions.pressed(_:)))
button.frame=NSRect(x:50,y:220,width:180,height:40)
window.contentView!.addSubview(button)
let field=NSTextField(string:"CONTROLLED-SECRET-DO-NOT-LOG")
field.frame=NSRect(x:50,y:140,width:400,height:40)
window.contentView!.addSubview(field)
let status=NSTextField(labelWithString:"Controlled fixture only — no user content")
status.frame=NSRect(x:50,y:80,width:450,height:30)
window.contentView!.addSubview(status)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps:true)
func screen(_ rect: NSRect) -> CGRect {
 let screenRect=window.convertToScreen(rect)
 let top=NSScreen.screens.first!.frame.maxY
 return CGRect(x:screenRect.minX,y:top-screenRect.maxY,width:screenRect.width,height:screenRect.height)
}
FileHandle.standardInput.readabilityHandler={ handle in
 let data=handle.availableData
 let command=String(data:data,encoding:.utf8) ?? ""
 DispatchQueue.main.async {
  if data.isEmpty||command.contains("quit")||command.contains("stop"){ app.terminate(nil) }
  else if command.contains("geometry"){output(["type":"geometry","button":NSStringFromRect(screen(button.frame)),"window":window.windowNumber])}
  else if command.contains("other"){
   otherWindow=NSWindow(contentRect:NSRect(x:240,y:350,width:350,height:200),styleMask:[.titled],backing:.buffered,defer:false)
   otherWindow!.isReleasedWhenClosed=false
   otherWindow!.title="Other controlled fixture window"
   let other=NSButton(title:"Other action",target:action,action:#selector(Actions.pressed(_:)))
   other.frame=NSRect(x:30,y:60,width:180,height:40);otherWindow!.contentView!.addSubview(other)
   otherWindow!.makeKeyAndOrderFront(nil)
   DispatchQueue.main.asyncAfter(deadline:.now()+0.2){
    let rect=otherWindow!.convertToScreen(other.frame),top=NSScreen.screens.first!.frame.maxY
    let point=CGPoint(x:rect.midX,y:top-rect.midY),source=CGEventSource(stateID:.hidSystemState)
    CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)!.post(tap:.cgSessionEventTap)
    CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left)!.post(tap:.cgSessionEventTap)
    DispatchQueue.main.asyncAfter(deadline:.now()+0.1){CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left)!.post(tap:.cgSessionEventTap)}
   }
  }
  else if command.contains("restore"){otherWindow?.close();otherWindow=nil;window.makeKeyAndOrderFront(nil);output(["type":"restored"])}
  else if command.contains("move"){window.setFrameOrigin(NSPoint(x:340,y:280));output(["type":"moved"])}
  else if command.contains("click"){
   app.activate(ignoringOtherApps:true)
   let r=screen(button.frame),p=CGPoint(x:r.midX,y:r.midY)
   DispatchQueue.main.asyncAfter(deadline:.now()+0.25){
   output(["type":"click-sent","focused":NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier])
   let source=CGEventSource(stateID:.hidSystemState)
   CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
   CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
   DispatchQueue.main.asyncAfter(deadline:.now()+0.1){
    CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
   }
   }
  }
 }
}
DispatchQueue.main.asyncAfter(deadline:.now()+0.5){ output(["type":"ready","window":window.windowNumber,"pid":ProcessInfo.processInfo.processIdentifier]) }
app.run()
