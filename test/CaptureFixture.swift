import AppKit
import ApplicationServices
func output(_ value: [String:Any]) { let data=try! JSONSerialization.data(withJSONObject:value);FileHandle.standardOutput.write(data+Data([10])) }
var resizeNextClick=false
final class PaintedButton:NSButton {
 override func draw(_ dirtyRect:NSRect) {
  if ProcessInfo.processInfo.environment["GUIDES_TEST_WINDOW_RESIZE"] == "1" { NSColor.magenta.setFill();NSBezierPath(rect:bounds).fill() }
  else { super.draw(dirtyRect) }
 }
 override func mouseDown(with event:NSEvent) {
  if resizeNextClick,let window=window {
   resizeNextClick=false
   for index in 0..<160 { DispatchQueue.main.asyncAfter(deadline:.now()+Double(index)*0.0125){window.setContentSize(NSSize(width:index%2==0 ? 880:560,height:340))} }
   DispatchQueue.main.asyncAfter(deadline:.now()+2.1){window.setContentSize(NSSize(width:560,height:340));output(["type":"resize-restored"])}
  }
  super.mouseDown(with:event)
 }
}
final class Actions: NSObject {
 var dialog:NSWindow?
 @objc func menuSelected(_ sender:NSMenuItem) {
  output(["type":"menu-selected","label":sender.title])
  if sender.title == "Open dialog" {
   let sheet=NSWindow(contentRect:NSRect(x:0,y:0,width:360,height:180),styleMask:[.titled],backing:.buffered,defer:false);sheet.isReleasedWhenClosed=false;sheet.title="Controlled dialog"
   let close=NSButton(title:"Confirm dialog",target:self,action:#selector(closeDialog(_:)));close.frame=NSRect(x:70,y:65,width:200,height:40);sheet.contentView!.addSubview(close);dialog=sheet;window.beginSheet(sheet);output(["type":"dialog-opened"])
  }
 }
 @objc func closeDialog(_ sender:NSButton) { if let dialog=dialog { window.endSheet(dialog);dialog.close();self.dialog=nil };output(["type":"dialog-closed"]) }

 @objc func pressed(_ sender: NSButton) { output(["type":"clicked","label":sender.title]) }
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let action=Actions()
var otherWindow: NSWindow?
var workflowScroll:NSScrollView?
let window=NSWindow(contentRect:NSRect(x:220,y:220,width:560,height:340),styleMask:[.titled,.closable],backing:.buffered,defer:false)
window.isReleasedWhenClosed=false
window.title="MatiQ Copycat Native Fixture"
let button=PaintedButton(title:"Open settings",target:action,action:#selector(Actions.pressed(_:)))
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
if ProcessInfo.processInfo.environment["GUIDES_TEST_DESKTOP_WORKFLOW"] == "1" {
 let menu=NSMenu();let own=NSMenuItem();own.submenu=NSMenu(title:"Fixture");menu.addItem(own)
 let edit=NSMenuItem(title:"Edit",action:nil,keyEquivalent:"");let editing=NSMenu(title:"Edit")
 for (title,selector,key) in [("Cut","cut:","x"),("Copy","copy:","c"),("Paste","paste:","v"),("Select All","selectAll:","a")] { editing.addItem(NSMenuItem(title:title,action:Selector(selector),keyEquivalent:key)) }
 edit.submenu=editing;menu.addItem(edit)
 let workflow=NSMenuItem(title:"Workflow",action:nil,keyEquivalent:"");let actions=NSMenu(title:"Workflow")
 for (title,key) in [("Open dialog",""),("Save","s")] { let item=NSMenuItem(title:title,action:#selector(Actions.menuSelected(_:)),keyEquivalent:key);item.target=action;actions.addItem(item) }
 workflow.submenu=actions;menu.addItem(workflow);app.mainMenu=menu
 let scroll=NSScrollView(frame:NSRect(x:470,y:20,width:70,height:100));let document=NSView(frame:NSRect(x:0,y:0,width:70,height:800));document.wantsLayer=true;document.layer?.backgroundColor=NSColor.orange.cgColor;scroll.documentView=document;scroll.hasVerticalScroller=true;window.contentView!.addSubview(scroll);workflowScroll=scroll;scroll.contentView.scroll(to:NSPoint(x:0,y:700));scroll.reflectScrolledClipView(scroll.contentView)
 let context=NSMenu();let item=NSMenuItem(title:"Context action",action:#selector(Actions.menuSelected(_:)),keyEquivalent:"");item.target=action;context.addItem(item);button.menu=context
}
func screen(_ rect: NSRect) -> CGRect {
 let screenRect=window.convertToScreen(rect)
 let top=NSScreen.screens.first!.frame.maxY
 return CGRect(x:screenRect.minX,y:top-screenRect.maxY,width:screenRect.width,height:screenRect.height)
}
func workflowLater(_ seconds:TimeInterval,_ body:@escaping()->Void) {
 let timer=Timer(timeInterval:seconds,repeats:false){_ in body()};RunLoop.main.add(timer,forMode:.common)
}
func fixtureMain(_ body:@escaping()->Void) {
 if ProcessInfo.processInfo.environment["GUIDES_TEST_DESKTOP_WORKFLOW"] == "1" {
  CFRunLoopPerformBlock(CFRunLoopGetMain(),CFRunLoopMode.commonModes.rawValue,body);CFRunLoopWakeUp(CFRunLoopGetMain())
 } else { DispatchQueue.main.async(execute:body) }
}
FileHandle.standardInput.readabilityHandler={ handle in
 let data=handle.availableData
 let command=String(data:data,encoding:.utf8) ?? ""
 fixtureMain {
  if data.isEmpty||command.contains("quit")||command.contains("stop"){ app.terminate(nil) }
  else if ProcessInfo.processInfo.environment["GUIDES_TEST_DESKTOP_WORKFLOW"] == "1" && command.contains("workflow-") {
   if command.hasPrefix("workflow-pointer|") {
    let parts=command.trimmingCharacters(in:.whitespacesAndNewlines).split(separator:"|")
    if parts.count == 4,let pid=Int32(parts[1]) { NSRunningApplication(processIdentifier:pid)?.activate(options:[]) }
   } else { app.activate(ignoringOtherApps:true) }
   func attribute(_ element:AXUIElement,_ name:CFString)->CFTypeRef? { var value:CFTypeRef?;return AXUIElementCopyAttributeValue(element,name,&value) == .success ? value:nil }
   func children(_ element:AXUIElement)->[AXUIElement] { attribute(element,kAXChildrenAttribute as CFString) as? [AXUIElement] ?? [] }
   func point(_ element:AXUIElement)->CGPoint? {
    guard let p=attribute(element,kAXPositionAttribute as CFString),let s=attribute(element,kAXSizeAttribute as CFString),CFGetTypeID(p)==AXValueGetTypeID(),CFGetTypeID(s)==AXValueGetTypeID() else { return nil }
    var origin=CGPoint.zero,size=CGSize.zero;AXValueGetValue(p as! AXValue,.cgPoint,&origin);AXValueGetValue(s as! AXValue,.cgSize,&size);return CGPoint(x:origin.x+size.width/2,y:origin.y+size.height/2)
   }
   func press(_ p:CGPoint,right:Bool=false,after:(()->Void)?=nil) {
    let source=CGEventSource(stateID:.hidSystemState)
    CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)
    CGEvent(mouseEventSource:source,mouseType:right ? .rightMouseDown:.leftMouseDown,mouseCursorPosition:p,mouseButton:right ? .right:.left)!.post(tap:.cgSessionEventTap)
    workflowLater(0.1){CGEvent(mouseEventSource:source,mouseType:right ? .rightMouseUp:.leftMouseUp,mouseCursorPosition:p,mouseButton:right ? .right:.left)!.post(tap:.cgSessionEventTap);after?()}
   }
   func key(_ code:CGKeyCode,flags:CGEventFlags=[]) {
    let source=CGEventSource(stateID:.hidSystemState)
    for down in [true,false] { let event=CGEvent(keyboardEventSource:source,virtualKey:code,keyDown:down)!;event.flags=flags;event.post(tap:.cgSessionEventTap) }
   }
   workflowLater(0.35){
    if command.hasPrefix("workflow-pointer|") {
     let parts=command.trimmingCharacters(in:.whitespacesAndNewlines).split(separator:"|")
     guard parts.count == 4,let x=Double(parts[2]),let y=Double(parts[3]),x.isFinite,y.isFinite else { output(["type":"fixture-error","reason":"Invalid owned browser pointer stimulus"]);return }
     press(CGPoint(x:x,y:y)){output(["type":"pointer-sent"])}
    } else if command.contains("workflow-menu-open") || command.contains("workflow-menu-dialog") {
     let own=AXUIElementCreateApplication(ProcessInfo.processInfo.processIdentifier)
     guard let bar=attribute(own,kAXMenuBarAttribute as CFString) else { output(["type":"fixture-error","reason":"No native menu bar"]);return }
     let entries=children(bar as! AXUIElement)
     guard let item=entries.first(where:{attribute($0,kAXTitleAttribute as CFString) as? String == "Workflow"}) else { output(["type":"fixture-error","reason":"No Workflow menu"]);return }
     let selected:AXUIElement
     if command.contains("workflow-menu-dialog") {
      guard let menu=children(item).first,let entry=children(menu).first(where:{attribute($0,kAXTitleAttribute as CFString) as? String == "Open dialog"}) else { output(["type":"fixture-error","reason":"Open dialog menu item not visible"]);return };selected=entry
     } else { selected=item }
     guard let p=point(selected) else { output(["type":"fixture-error","reason":"No native menu geometry"]);return };press(p){output(["type":"workflow-command"])}
    } else if command.contains("workflow-dialog-close"),let dialog=action.dialog,let button=dialog.contentView?.subviews.compactMap({$0 as? NSButton}).first {
     let rect=dialog.convertToScreen(button.frame),top=NSScreen.screens.first!.frame.maxY;press(CGPoint(x:rect.midX,y:top-rect.midY))
    } else if command.contains("workflow-type") {
     let rect=screen(field.frame);press(CGPoint(x:rect.midX,y:rect.midY)){
      workflowLater(0.35){
       let text=Array("CONTROLLED-TYPING-SECRET".utf16)
       text.withUnsafeBufferPointer { buffer in
        for down in [true,false] { let event=CGEvent(keyboardEventSource:CGEventSource(stateID:.hidSystemState),virtualKey:0,keyDown:down)!;event.keyboardSetUnicodeString(stringLength:text.count,unicodeString:buffer.baseAddress!);event.post(tap:.cgSessionEventTap) }
       };output(["type":"typed"])
      }
     }
    } else if command.contains("workflow-edit-select") {
     let rect=screen(field.frame);press(CGPoint(x:rect.midX,y:rect.midY)){workflowLater(0.35){key(0,flags:.maskCommand);output(["type":"edit-selected"])}}
    } else if command.contains("workflow-copy") { key(8,flags:.maskCommand);output(["type":"copied"]) }
    else if command.contains("workflow-cut") { key(7,flags:.maskCommand);workflowLater(0.45){output(["type":"cut","empty":(field.currentEditor()?.string ?? field.stringValue).isEmpty])} }
    else if command.contains("workflow-paste") { key(9,flags:.maskCommand);workflowLater(0.45){output(["type":"pasted","restored":(field.currentEditor()?.string ?? field.stringValue).contains("CONTROLLED-TYPING-SECRET")])} }
    else if command.contains("workflow-shortcut") { key(1,flags:.maskCommand);output(["type":"shortcut-sent"]) }
    else if command.contains("workflow-right") { let rect=screen(button.frame);press(CGPoint(x:rect.midX,y:rect.midY),right:true){output(["type":"right-sent"])} }
    else if command.contains("workflow-escape") { key(53);output(["type":"escape-sent"]) }
    else if command.contains("workflow-scroll"),let scroll=workflowScroll {
     let before=scroll.contentView.bounds.minY,rect=screen(scroll.frame),point=CGPoint(x:rect.midX,y:rect.midY)
     for n in 0...3 { workflowLater(Double(n)*0.1){
      let event=CGEvent(scrollWheelEvent2Source:CGEventSource(stateID:.hidSystemState),units:.pixel,wheelCount:1,wheel1:-100,wheel2:0,wheel3:0)!;event.location=point;event.post(tap:.cgSessionEventTap)
     }}
     workflowLater(0.7){output(["type":"scrolled","before":before,"origin":scroll.contentView.bounds.minY])}
    }
    else if command.contains("workflow-double") {
     let rect=screen(button.frame),p=CGPoint(x:rect.midX,y:rect.midY),source=CGEventSource(stateID:.hidSystemState)
     for n in 0...1 { workflowLater(Double(n)*0.15){
      let down=CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:p,mouseButton:.left)!;down.setIntegerValueField(.mouseEventClickState,value:Int64(n+1));down.post(tap:.cgSessionEventTap)
      workflowLater(0.06){let up=CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:p,mouseButton:.left)!;up.setIntegerValueField(.mouseEventClickState,value:Int64(n+1));up.post(tap:.cgSessionEventTap);if n==1 { output(["type":"double-sent"]) }}
     }}
    }
    else if command.contains("workflow-drag") {
     let rect=screen(status.frame),start=CGPoint(x:rect.minX+10,y:rect.midY),end=CGPoint(x:rect.maxX-10,y:rect.midY),source=CGEventSource(stateID:.hidSystemState)
     CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:start,mouseButton:.left)!.post(tap:.cgSessionEventTap)
     for n in 1...5 { DispatchQueue.main.asyncAfter(deadline:.now()+Double(n)*0.04){let p=CGPoint(x:start.x+(end.x-start.x)*Double(n)/5,y:start.y);CGEvent(mouseEventSource:source,mouseType:.leftMouseDragged,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cgSessionEventTap)} }
     DispatchQueue.main.asyncAfter(deadline:.now()+0.3){CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:end,mouseButton:.left)!.post(tap:.cgSessionEventTap);output(["type":"drag-sent"])}
    }
   }
  }
  else if command.contains("resize-next"){resizeNextClick=true;output(["type":"resize-armed"])}
  else if command.contains("display-change") || command.contains("display-scale"){
   let scaling=command.contains("display-scale")
   let options:CFDictionary?=scaling ? [kCGDisplayShowDuplicateLowResolutionModes as String:true] as CFDictionary:nil
   let display=CGMainDisplayID()
   guard let original=CGDisplayCopyDisplayMode(display),
         let modes=CGDisplayCopyAllDisplayModes(display,options) as? [CGDisplayMode],
         let changed=modes.first(where:{scaling ? ($0.width==original.width && $0.height==original.height && $0.pixelWidth != original.pixelWidth):($0.width>=1600 && $0.ioDisplayModeID != original.ioDisplayModeID)}) else {
    output(["type":"display-changed","error":"No alternate actual display mode is available."]);return
   }
   var configuration:CGDisplayConfigRef?
   guard CGBeginDisplayConfiguration(&configuration) == .success,
         CGConfigureDisplayWithDisplayMode(configuration,display,changed,nil) == .success else {
    if let configuration=configuration { CGCancelDisplayConfiguration(configuration) }
    output(["type":"display-changed","error":"The actual display configuration could not begin."]);return
   }
   let result=CGCompleteDisplayConfiguration(configuration,.forAppOnly)
   let actual=CGDisplayCopyDisplayMode(display)
   output(["type":"display-changed","result":result.rawValue,"before":Int(original.ioDisplayModeID),"after":Int(actual?.ioDisplayModeID ?? 0),"beforeSize":[original.width,original.height],"afterSize":[actual?.width ?? 0,actual?.height ?? 0],"beforePixels":[original.pixelWidth,original.pixelHeight],"afterPixels":[actual?.pixelWidth ?? 0,actual?.pixelHeight ?? 0]])
   DispatchQueue.main.asyncAfter(deadline:.now()+(scaling ? 20:3)){
    var restore:CGDisplayConfigRef?
    let begin=CGBeginDisplayConfiguration(&restore)
    let configure=begin == .success ? CGConfigureDisplayWithDisplayMode(restore,display,original,nil) : begin
    let restored=configure == .success ? CGCompleteDisplayConfiguration(restore,.forAppOnly) : configure
    if configure != .success,let restore=restore { CGCancelDisplayConfiguration(restore) }
    output(["type":"display-restored","result":restored.rawValue,"mode":Int(CGDisplayCopyDisplayMode(display)?.ioDisplayModeID ?? 0)])
   }
  }
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
