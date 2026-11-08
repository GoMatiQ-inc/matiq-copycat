import AppKit
import ApplicationServices

// Test-only input driver for one newly launched TextEdit instance and owned fixture file.
func output(_ value: [String:Any]) {
 let data=try! JSONSerialization.data(withJSONObject:value)
 FileHandle.standardOutput.write(data+Data([10]))
}
func attribute(_ element: AXUIElement,_ name: String) -> CFTypeRef? {
 var value: CFTypeRef?
 return AXUIElementCopyAttributeValue(element,name as CFString,&value) == .success ? value : nil
}
func text(_ element: AXUIElement,_ name: String) -> String { attribute(element,name) as? String ?? "" }
func descendants(_ root: AXUIElement) -> [AXUIElement] {
 var result=[root],index=0
 while index<result.count && result.count<1000 {
  result.append(contentsOf:attribute(result[index],kAXChildrenAttribute) as? [AXUIElement] ?? [])
  index+=1
 }
 return result
}
func bounds(_ element: AXUIElement) -> CGRect? {
 guard let p=attribute(element,kAXPositionAttribute),let s=attribute(element,kAXSizeAttribute),
       CFGetTypeID(p)==AXValueGetTypeID(),CFGetTypeID(s)==AXValueGetTypeID() else { return nil }
 var point=CGPoint.zero,size=CGSize.zero
 guard AXValueGetValue(p as! AXValue,.cgPoint,&point),AXValueGetValue(s as! AXValue,.cgSize,&size) else {return nil}
 return CGRect(origin:point,size:size)
}
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
if CommandLine.arguments.contains("--request") && !CGPreflightScreenCaptureAccess() { _=CGRequestScreenCaptureAccess() }
let access=AXIsProcessTrusted(),screen=CGPreflightScreenCaptureAccess()
if CommandLine.arguments.contains("--probe") {
 output(["accessibility":access,"screen":screen]);exit(access && screen ? 0 : 1)
}
guard access && screen else {
 output(["type":"error","reason":"Authorize the CI test driver in macOS Accessibility and Screen Recording inside Tart before running the controlled TextEdit fixture.","accessibility":access,"screen":screen]);exit(1)
}
let document=URL(fileURLWithPath:CommandLine.arguments[1])
var target: NSRunningApplication?
var windowID: UInt32=0
func fail(_ reason:String) {output(["type":"error","reason":reason]);app.terminate(nil)}
func ownedWindow() -> AXUIElement? {
 guard let target=target else {return nil}
 let windows=attribute(AXUIElementCreateApplication(target.processIdentifier),kAXWindowsAttribute) as? [AXUIElement] ?? []
 return windows.first { text($0,kAXTitleAttribute).contains(document.deletingPathExtension().lastPathComponent) }
}
func focus(_ done:@escaping (AXUIElement)->Void) {
 guard let target=target,let window=ownedWindow() else {fail("The owned TextEdit document is no longer available.");return}
 target.activate(options:[])
 AXUIElementPerformAction(window,kAXRaiseAction as CFString)
 DispatchQueue.main.asyncAfter(deadline:.now()+0.3) {
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier==target.processIdentifier else {fail("The owned TextEdit instance could not receive focus.");return}
  done(window)
 }
}
func keys(_ code:CGKeyCode,flags:CGEventFlags) {
 let source=CGEventSource(stateID:.hidSystemState)
 for down in [true,false] {let event=CGEvent(keyboardEventSource:source,virtualKey:code,keyDown:down)!;event.flags=flags;event.post(tap:.cgSessionEventTap)}
}
FileHandle.standardInput.readabilityHandler={ handle in
 let data=handle.availableData,commands=String(data:data,encoding:.utf8) ?? ""
 DispatchQueue.main.async {
  if data.isEmpty||commands.contains("stop") {target?.terminate();app.terminate(nil);return}
  if commands.contains("select") {focus { _ in keys(0,flags:.maskCommand);DispatchQueue.main.asyncAfter(deadline:.now()+0.2){output(["type":"selected"])}}}
  else if commands.contains("bold") {focus { window in
   let controls=descendants(window)
   guard let button=controls.first(where:{["AXButton","AXCheckBox"].contains(text($0,kAXRoleAttribute)) && [text($0,kAXTitleAttribute),text($0,kAXDescriptionAttribute),text($0,kAXHelpAttribute)].contains(where:{$0.lowercased()=="bold"})}),let r=bounds(button),r.width>0,r.height>0 else {fail("The controlled TextEdit document has no accessible Bold control.");return}
   let p=CGPoint(x:r.midX,y:r.midY),source=CGEventSource(stateID:.hidSystemState)
   CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
   CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
   DispatchQueue.main.asyncAfter(deadline:.now()+0.1) {
    CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
    output(["type":"clicked","window":windowID,"target":["x":r.minX,"y":r.minY,"width":r.width,"height":r.height]])
   }
  }}
  else if commands.contains("save") {focus { _ in keys(1,flags:.maskCommand);DispatchQueue.main.asyncAfter(deadline:.now()+0.5){output(["type":"saved"])}}}
 }
}
let configuration=NSWorkspace.OpenConfiguration()
configuration.createsNewApplicationInstance=true
configuration.arguments=["-ApplePersistenceIgnoreState","YES","-NSQuitAlwaysKeepsWindows","NO"]
NSWorkspace.shared.open([document],withApplicationAt:URL(fileURLWithPath:"/System/Applications/TextEdit.app"),configuration:configuration) { running,error in
 DispatchQueue.main.async {
  guard let running=running,running.bundleIdentifier=="com.apple.TextEdit" else {fail("A fresh TextEdit instance could not be launched.");return}
  target=running
  output(["type":"owned","pid":running.processIdentifier])
  var attempts=0
  func ready() {
   attempts+=1
   let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
   if let window=ownedWindow(),let row=rows.first(where:{($0[kCGWindowOwnerPID as String] as? Int32)==running.processIdentifier && ($0[kCGWindowLayer as String] as? Int)==0 && ($0[kCGWindowName as String] as? String ?? "").contains(document.deletingPathExtension().lastPathComponent)}),let id=row[kCGWindowNumber as String] as? UInt32 {
    windowID=id
    let names=descendants(window).filter{["AXButton","AXCheckBox"].contains(text($0,kAXRoleAttribute))}.prefix(30).map{["role":text($0,kAXRoleAttribute),"title":text($0,kAXTitleAttribute),"description":text($0,kAXDescriptionAttribute),"help":text($0,kAXHelpAttribute)]}
    output(["type":"ready","pid":running.processIdentifier,"window":id,"controls":names]);return
   }
   if attempts>=40 {
    let windows=attribute(AXUIElementCreateApplication(running.processIdentifier),kAXWindowsAttribute) as? [AXUIElement] ?? []
    let ownRows=rows.filter{($0[kCGWindowOwnerPID as String] as? Int32)==running.processIdentifier}
    output(["type":"fixture-diagnostic","accessibility":AXIsProcessTrusted(),"screen":CGPreflightScreenCaptureAccess(),"ownedAXWindowTitles":windows.map{text($0,kAXTitleAttribute)},"ownedScreenWindows":ownRows.map{["title":$0[kCGWindowName as String] as? String ?? "","layer":$0[kCGWindowLayer as String] as? Int ?? -1]}])
    fail("The controlled TextEdit document did not become accessible despite granted test-driver permissions. Inspect the owned fixture window metadata.");return
   }
   DispatchQueue.main.asyncAfter(deadline:.now()+0.25){ready()}
  }
  ready()
 }
}
app.run()
