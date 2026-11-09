import AppKit
import ScreenCaptureKit
import ApplicationServices
import CoreImage
import CoreMedia

// A mouse-only, selected-window recorder. Stdout is a private JSON-lines pipe.
func send(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}
func fail(_ reason: String) -> Never {
    send(["type": "issue", "reason": reason])
    exit(1)
}
func applicationContext(_ app: SCRunningApplication) -> (name:String,bundle:String)? {
    let running = NSRunningApplication(processIdentifier:app.processID)
    let bundle = app.bundleIdentifier.isEmpty ? (running?.bundleIdentifier ?? "") : app.bundleIdentifier
    guard !bundle.isEmpty else { return nil }
    let names = [app.applicationName, running?.localizedName ?? "", bundle]
    guard let name = names.first(where: { !$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty }) else { return nil }
    return (String(name.prefix(200)),bundle)
}
func permitted(_ window: SCWindow) -> Bool {
    guard let app = window.owningApplication, let context = applicationContext(app) else { return false }
    let id = context.bundle.lowercased()
    let browsers = ["com.google.chrome", "com.microsoft.edgemac", "org.mozilla.firefox", "com.apple.safari", "com.brave.browser", "com.operasoftware.opera", "company.thebrowser.browser", "org.chromium.chromium"]
    return window.windowLayer == 0 && window.frame.width > 40 && window.frame.height > 40 &&
        !id.hasPrefix("com.matiq.") && !browsers.contains(where: { id == $0 || id.hasPrefix($0 + ".") })
}
func content() async throws -> SCShareableContent {
    try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
}
func text(_ element: AXUIElement, _ key: CFString) -> String {
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key, &result) == .success else { return "" }
    return result as? String ?? ""
}
func target(_ point: CGPoint, pid: pid_t, frame: CGRect, observedWindow: inout AXUIElement?) -> [String: Any] {
    var found: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &found) == .success,
          let element = found else { return [:] }
    var owner: pid_t = 0
    guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { return [:] }
    let roles = ["AXButton": "button", "AXLink": "link", "AXCheckBox": "checkbox", "AXRadioButton": "radio button", "AXPopUpButton": "dropdown", "AXMenuItem": "menu item", "AXMenuBarItem": "menu"]
    let role = text(element, kAXRoleAttribute as CFString)
    var windowValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &windowValue) == .success,
       let windowValue = windowValue, CFGetTypeID(windowValue) == AXUIElementGetTypeID() {
        observedWindow = (windowValue as! AXUIElement)
    }

    // Never read AXValue, selected text, document URLs, or text-field contents.
    var result: [String: Any] = ["control": roles[role] ?? "control"]
    if roles[role] != nil {
        let title = text(element,kAXTitleAttribute as CFString)
        let label = title.isEmpty ? text(element,kAXDescriptionAttribute as CFString) : title
        result["label"] = String(label.prefix(60))
    }
    var position: CFTypeRef?, size: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
       AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
       let position = position, let size = size,
       CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() {
        var origin = CGPoint.zero, dimensions = CGSize.zero
        AXValueGetValue(position as! AXValue, .cgPoint, &origin)
        AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
        let rect = CGRect(origin: origin, size: dimensions).intersection(frame)
        if !rect.isNull && rect.width > 0 && rect.height > 0 {
            result["target"] = ["x": (rect.minX-frame.minX)/frame.width, "y": (rect.minY-frame.minY)/frame.height, "width": rect.width/frame.width, "height": rect.height/frame.height]
        }
    }
    return result
}

@MainActor func displaySignature() -> String {
    NSScreen.screens.map { screen in
        "\(screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] ?? 0):\(NSStringFromRect(screen.frame)):\(screen.backingScaleFactor)"
    }.sorted().joined(separator: ";")
}
let geometryWarning = "The selected window moved or resized while its screenshot was pending. Capture stopped; review the last action and explicitly resume."
@MainActor final class Recorder {
    let id: CGWindowID
    let pid: pid_t
    let application: String
    var monitor: Any?
    var timer: Timer?
    var observers: [NSObjectProtocol] = []
    var screenObserver: NSObjectProtocol?
    var busy = false
    var stopped = false
    init(window: SCWindow) {
        id = window.windowID
        pid = window.owningApplication!.processID
        guard let context = applicationContext(window.owningApplication!) else { fail("The selected application identity changed. Refresh the window list before recording.") }
        application = context.name
    }
    func stop(_ reason: String? = nil) {
        guard !stopped else { return }
        stopped = true
        if let monitor = monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        timer?.invalidate(); timer = nil
        for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observers = []
        if let screenObserver = screenObserver { NotificationCenter.default.removeObserver(screenObserver) }; screenObserver = nil
        if let reason = reason { send(["type": "issue", "reason": reason]) }
        else if busy { send(["type": "issue", "reason": "Recording stopped while a screenshot was pending. The last action may be missing; review it before sharing."]) }
        // Await an in-flight screenshot before exiting; never emit it after stop.
        if !busy { send(["type": "stopped"]); exit(reason == nil ? 0 : 1) }
    }
    func start() {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            guard let self = self, !self.stopped,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == self.pid,
                  let point = event.cgEvent?.location else { return }
            let at = Int64(Date().timeIntervalSince1970 * 1000)
            Task { @MainActor in await self.click(point: point, at: at) }
        }
        guard monitor != nil else { stop("Mouse observation could not start. Check Accessibility permission and retry."); return }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.stop("The Mac slept or locked. Capture stopped; explicitly resume when ready.") }
            })
        }
        let initialDisplays = displaySignature()
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if displaySignature() != initialDisplays { self?.stop("Display configuration changed. Capture stopped; review alignment and explicitly resume.") } }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, !self.stopped else { return }
                if !CGPreflightScreenCaptureAccess() || !AXIsProcessTrusted() {
                    self.stop("Screen Recording or Accessibility permission was revoked. Capture stopped; restore permission before resuming.")
                } else if NSRunningApplication(processIdentifier: self.pid)?.isTerminated != false {
                    self.stop("The selected application closed. Capture stopped; choose a new window.")
                } else if !self.busy {
                    do {
                        let windows = try await content()
                        if !windows.windows.contains(where: { $0.windowID == self.id }) {
                            self.stop("The selected window closed or is no longer on screen. Capture stopped; restore or select a window.")
                        }
                    } catch { self.stop("The selected window could not be checked. Capture stopped; check Screen Recording permission.") }
                }
            }
        }
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor in
                // The parent owns this process. EOF or any input is an unconditional stop.
                _ = data; self?.stop()
            }
        }
        if !stopped { send(["type": "ready", "window": id, "application": application]) }
    }
    func click(point: CGPoint, at: Int64) async {
        guard !stopped else { return }
        // Never silently drop a meaningful action while a prior image is pending.
        if busy { stop("Actions arrived faster than screenshots could be captured. Review the last step, then resume more slowly."); return }
        busy = true
        defer {
            busy = false
            if stopped { send(["type": "stopped"]); exit(0) }
        }
        do {
            let available = try await content()
            guard !stopped else { return }
            guard let window = available.windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == pid }), permitted(window) else {
                stop("The selected window changed or closed. Choose a window again."); return
            }
            guard window.frame.contains(point), NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return }
            // Reject clicks in another window or an overlay, even within the selected window's rectangle.
            let visible = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
            let top = visible.first { row in
                guard (row[kCGWindowLayer as String] as? Int) == 0,
                      let bounds = row[kCGWindowBounds as String] as? [String: Any],
                      let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
                return rect.contains(point)
            }
            guard (top?[kCGWindowNumber as String] as? UInt32) == id else { return }
            var observedWindow: AXUIElement?
            var context = target(point, pid: pid, frame: window.frame, observedWindow: &observedWindow)
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            let scale = CGFloat(filter.pointPixelScale)
            config.width = max(1, Int(filter.contentRect.width * scale))
            config.height = max(1, Int(filter.contentRect.height * scale))
            guard config.width <= 32768 && config.height <= 32768 && Int64(config.width) * Int64(config.height) <= 32000000 else { stop("The selected window exceeds 32 megapixels. Reduce its size and explicitly resume."); return }
            config.ignoreShadowsSingleWindow = true
            config.includeChildWindows = false
            config.showsCursor = false
            let frame = window.frame
            let geometryChanged = {
                guard let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, self.id) as? [[String: Any]],
                      let bounds = rows.first?[kCGWindowBounds as String] as? [String: Any],
                      let current = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return true }
                return current != frame
            }
            guard !geometryChanged() else { stop(geometryWarning); return }
            var geometryObserver: AXObserver?
            var registered: [CFString] = []
            var geometryMonitored = false
            if let observedWindow = observedWindow,
               AXObserverCreate(pid, { _, _, _, pointer in
                   guard let pointer = pointer else { return }
                   let recorder = Unmanaged<Recorder>.fromOpaque(pointer).takeUnretainedValue()
                   MainActor.assumeIsolated { recorder.stop(geometryWarning) }
               }, &geometryObserver) == .success, let observer = geometryObserver {
                let names: [CFString] = [kAXWindowMovedNotification as CFString, kAXMovedNotification as CFString, kAXWindowResizedNotification as CFString, kAXResizedNotification as CFString]
                var supported: [Bool] = []
                for name in names {
                    let success = AXObserverAddNotification(observer, observedWindow, name, Unmanaged.passUnretained(self).toOpaque()) == .success
                    supported.append(success)
                    if success { registered.append(name) }
                }
                geometryMonitored = (supported[0] || supported[1]) && (supported[2] || supported[3])
                CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
            }
            defer {
                if let observer = geometryObserver {
                    CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
                    if let observedWindow = observedWindow {
                        for name in registered { AXObserverRemoveNotification(observer, observedWindow, name) }
                    }
                }
            }
            if !geometryMonitored {
                context.removeValue(forKey: "target")
                context["reviewTarget"] = true
            }
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard !geometryChanged() else { stop(geometryWarning); return }
            guard !stopped else { return }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
                stop("Focus changed before the screenshot finished. Review the last action, then resume."); return
            }
            let ratio = min(1, 2000 / CGFloat(max(image.width, image.height)))
            let width = max(1, Int(CGFloat(image.width)*ratio)), height = max(1, Int(CGFloat(image.height)*ratio))
            guard let graphics = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { stop("Screenshot conversion failed. Stop and retry capture."); return }
            graphics.interpolationQuality = .high
            graphics.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            guard let resized = graphics.makeImage() else { stop("Screenshot conversion failed. Stop and retry capture."); return }
            let bitmap = NSBitmapImageRep(cgImage: resized)
            var encoded: Data?
            for quality in [0.95, 0.8, 0.65, 0.45] {
                if let bytes = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]), bytes.count <= 700000 { encoded = bytes; break }
            }
            guard let encoded = encoded else { stop("The selected window screenshot exceeds the capture limit. Reduce its size and resume."); return }
            var event: [String: Any] = ["type": "step", "at": at, "source": "desktop", "action": "click", "application": application, "image": ["mediaType": "image/jpeg", "data": encoded.base64EncodedString()]]
            for (key,value) in context { event[key] = value }
            send(event)
        } catch { stop("The selected window screenshot failed. Check Screen Recording permission and resume explicitly.") }
    }
}


@MainActor final class DesktopFrame: NSObject, SCStreamOutput, SCStreamDelegate {
    let display: SCDisplay
    let context = CIContext(options: [.cacheIntermediates: false])
    var stream: SCStream?
    var image: CGImage?
    var at: Int64 = 0
    var stopped = false
    var failed: (() -> Void)?
    init(display: SCDisplay) { self.display = display }
    func start(excluding applications: [SCRunningApplication]) async throws {
        let filter = SCContentFilter(display: display, excludingApplications: applications, exceptingWindows: [])
        let config = SCStreamConfiguration()
        let ratio = min(1, 2000 / CGFloat(max(display.width,display.height)))
        config.width = max(1,Int(CGFloat(display.width)*ratio))
        config.height = max(1,Int(CGFloat(display.height)*ratio))
        config.minimumFrameInterval = CMTime(value: 1, timescale: 10)
        config.queueDepth = 3
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = false
        let owned = SCStream(filter: filter, configuration: config, delegate: self)
        stream = owned
        try owned.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
        try await owned.startCapture()
    }
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        MainActor.assumeIsolated {
            guard !stopped, type == .screen, CMSampleBufferIsValid(sampleBuffer),
                  let items = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let raw = items.first?[.status] as? Int, let status = SCFrameStatus(rawValue:raw) else { return }
            if status == .idle { if image != nil { at = Int64(Date().timeIntervalSince1970*1000) }; return }
            guard status == .complete, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { image = nil; return }
            let source = CIImage(cvPixelBuffer:buffer)
            image = context.createCGImage(source, from:source.extent)
            at = Int64(Date().timeIntervalSince1970*1000)
        }
    }
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in if !self.stopped { self.image = nil; self.failed?() } }
    }
    func stop() async throws {
        stopped = true
        image = nil
        if let stream = stream { try await stream.stopCapture(); self.stream = nil }
    }
}

@MainActor final class WorkflowRecorder: NSObject {
    struct Action {
        var event: [String:Any]
        let image: CGImage
        let frame: CGRect
        let point: CGPoint
    }
    var frames: [DesktopFrame] = []
    var monitor: Any?
    var observers: [NSObjectProtocol] = []
    var screenObserver: NSObjectProtocol?
    var permissionTimer: Timer?
    var pendingTimer: Timer?
    var pending: Action?
    var gesture: Action?
    var dragged = false
    var stopped = false
    var statusItem: NSStatusItem?
    let owner = getppid()

    func start() async {
        do {
            let available = try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:true)
            guard !available.displays.isEmpty, available.displays.count <= 8 else { stop("Desktop recording supports one to eight screens. Adjust the display setup and resume."); return }
            let excluded = available.applications.filter { $0.processID == owner || $0.processID == getpid() }
            for display in available.displays {
                let frame = DesktopFrame(display:display)
                frame.failed = { [weak self] in self?.stop("The desktop screen stream ended. Check Screen Recording permission and explicitly resume.") }
                frames.append(frame)
                if stopped { return }
                try await frame.start(excluding:excluded)
                if stopped { return }
            }
            for _ in 0..<30 {
                if stopped { return }
                if frames.allSatisfy({ $0.image != nil }) { break }
                try await Task.sleep(nanoseconds:100_000_000)
            }
            guard frames.allSatisfy({ $0.image != nil }) else { stop("Desktop frames did not become available. Check Screen Recording permission and retry."); return }
            let mask: NSEvent.EventTypeMask = [.leftMouseDown,.leftMouseUp,.rightMouseDown,.rightMouseUp,.leftMouseDragged,.keyDown]
            monitor = NSEvent.addGlobalMonitorForEvents(matching:mask) { [weak self] event in self?.observe(event) }
            guard monitor != nil else { stop("Desktop interaction observation could not start. Check Accessibility permission and retry."); return }
            let center = NSWorkspace.shared.notificationCenter
            for name in [NSWorkspace.willSleepNotification,NSWorkspace.screensDidSleepNotification,NSWorkspace.sessionDidResignActiveNotification] {
                observers.append(center.addObserver(forName:name,object:nil,queue:.main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.stop("The Mac slept or locked. Recording stopped; explicitly resume when ready.") }
                })
            }
            let displays = displaySignature()
            screenObserver = NotificationCenter.default.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main) { [weak self] _ in
                MainActor.assumeIsolated { if displaySignature() != displays { self?.stop("Display configuration changed. Recording stopped; review screenshots and explicitly resume.") } }
            }
            permissionTimer = Timer.scheduledTimer(withTimeInterval:1,repeats:true) { [weak self] _ in
                MainActor.assumeIsolated { if !CGPreflightScreenCaptureAccess() || !AXIsProcessTrusted() { self?.stop("Screen Recording or Accessibility permission was revoked. Restore it before resuming.") } }
            }
            FileHandle.standardInput.readabilityHandler = { [weak self] handle in
                _ = handle.availableData
                Task { @MainActor in self?.stop() }
            }
            let item = NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
            item.button?.title = "● Copycat"
            item.button?.setAccessibilityLabel("Copycat is recording the desktop")
            let menu = NSMenu()
            for (title,selector) in [("Pause recording",#selector(pause)),("Finish guide",#selector(finish)),("Cancel capture",#selector(cancel))] {
                let row = NSMenuItem(title:title,action:selector,keyEquivalent:"");row.target = self;menu.addItem(row)
            }
            item.menu = menu;statusItem = item
            send(["type":"ready","window":0,"application":"Desktop workflow"])
        } catch { stop("Desktop recording could not start. Check screen and Accessibility permissions, then retry.") }
    }
    @objc func pause() { control("pause") }
    @objc func finish() { control("stop") }
    @objc func cancel() { control("cancel") }
    func control(_ command: String) {
        stop(nil,command:command)
    }
    func stop(_ reason: String? = nil, command: String? = nil) {
        guard !stopped else { return }
        stopped = true
        if let monitor = monitor { NSEvent.removeMonitor(monitor) };monitor = nil
        permissionTimer?.invalidate();permissionTimer = nil
        pendingTimer?.invalidate();pendingTimer = nil
        if command != "cancel" { flush() };pending = nil;gesture = nil
        for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) };observers = []
        if let observer = screenObserver { NotificationCenter.default.removeObserver(observer) };screenObserver = nil
        statusItem?.button?.title = "Stopping Copycat…"
        statusItem?.menu = nil
        for frame in frames { frame.stopped = true;frame.image = nil }
        if let reason = reason { send(["type":"issue","reason":reason]) }
        if let command = command { send(["type":"control","command":command]) }
        Task { @MainActor in
            var failed = false
            for frame in frames { do { try await frame.stop() } catch { failed = true } }
            frames = []
            if let item = statusItem { NSStatusBar.system.removeStatusItem(item) };statusItem = nil
            if failed { send(["type":"issue","reason":"A desktop screen stream failed to stop cleanly. Retry capture cleanup before closing."]) }
            send(["type":"stopped"])
            exit(failed || reason != nil ? 1:0)
        }
    }
    func snapshot(_ point: CGPoint, action: String) -> Action? {
        guard !stopped, let frame = frames.first(where: { $0.display.frame.contains(point) }),
              let image = frame.image, Int64(Date().timeIntervalSince1970*1000)-frame.at <= 1000 else {
            stop("A recent desktop frame is unavailable. The action was not captured; review it and explicitly resume."); return nil
        }
        var found: AXUIElement?
        let hit = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(point.x),Float(point.y),&found)
        var pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        if hit == .success, let element = found { _ = AXUIElementGetPid(element,&pid) }
        guard pid != owner, pid != getpid(), pid > 0 else { return nil }
        let running = NSRunningApplication(processIdentifier:pid)
        let application = String((running?.localizedName ?? running?.bundleIdentifier ?? "Application").prefix(200))
        var observed: AXUIElement?
        let box: [String:Any] = target(point,pid:pid,frame:frame.display.frame,observedWindow:&observed)
        var event: [String:Any] = ["type":"step","at":Int64(Date().timeIntervalSince1970*1000),"source":"desktop","action":action,"application":application]
        for (key,value) in box { event[key] = value }
        // A small click marker remains accurate even for controls without an AX rectangle.
        if event["target"] == nil {
            let rect = frame.display.frame
            let width = min(16,rect.width),height = min(16,rect.height)
            event["target"] = ["x":max(0,min(rect.width-width,point.x-rect.minX-width/2))/rect.width,"y":max(0,min(rect.height-height,point.y-rect.minY-height/2))/rect.height,"width":width/rect.width,"height":height/rect.height]
        }
        return Action(event:event,image:image,frame:frame.display.frame,point:point)
    }
    func observe(_ event: NSEvent) {
        guard !stopped else { return }
        switch event.type {
        case .leftMouseDown,.rightMouseDown:
            // Preserve a typing burst before the next independently observed action.
            if pending?.event["action"] as? String == "fill" { flush() }
            if event.clickCount != 2 { flush() }
            guard let point = event.cgEvent?.location else { return }
            gesture = snapshot(point,action:event.type == .rightMouseDown ? "right-click":"click")
            dragged = false
        case .leftMouseDragged: dragged = true
        case .leftMouseUp,.rightMouseUp:
            guard var action = gesture else { return };gesture = nil
            if dragged {
                action.event["action"] = "drag"
                if let end = event.cgEvent?.location, action.frame.contains(end) {
                    action.event["destination"] = ["x":max(0,min(0.98,(end.x-action.frame.minX)/action.frame.width)),"y":max(0,min(0.98,(end.y-action.frame.minY)/action.frame.height)),"width":0.02,"height":0.02]
                } else { action.event["reviewTarget"] = true }
            } else if event.clickCount == 2 { action.event["action"] = "double-click" }
            pending = action;schedule(0.3)
        case .keyDown:
            keyboard(event)
        default: break
        }
    }
    func keyboard(_ event: NSEvent) {
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != owner, app.processIdentifier != getpid() else { return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var focused: CFTypeRef?
        _ = AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),kAXFocusedUIElementAttribute as CFString,&focused)
        var focusPoint = event.cgEvent?.location ?? CGPoint.zero
        if let focused = focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
            let element = focused as! AXUIElement
            var position: CFTypeRef?,size: CFTypeRef?
            if AXUIElementCopyAttributeValue(element,kAXPositionAttribute as CFString,&position) == .success,
               AXUIElementCopyAttributeValue(element,kAXSizeAttribute as CFString,&size) == .success,
               let position = position,let size = size,CFGetTypeID(position) == AXValueGetTypeID(),CFGetTypeID(size) == AXValueGetTypeID() {
                var origin = CGPoint.zero,dimensions = CGSize.zero
                AXValueGetValue(position as! AXValue,.cgPoint,&origin);AXValueGetValue(size as! AXValue,.cgSize,&dimensions)
                focusPoint = CGPoint(x:origin.x+dimensions.width/2,y:origin.y+dimensions.height/2)
            }
        }
        var shortcut: String?
        if flags.contains(.command) || flags.contains(.control) {
            // Read a command key only while Command is held; never inspect normal typed characters.
            let commands = ["c":"copy","v":"paste","x":"cut","s":"save","z":flags.contains(.shift) ? "redo":"undo","a":"all","f":"find","o":"open","n":"new","w":"close"]
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            let recognized = flags.contains(.command) && !flags.contains(.control) && !flags.contains(.option) && (!flags.contains(.shift) || key == "z")
            shortcut = recognized ? (commands[key] ?? "manual"):"manual"
        } else {
            shortcut = [36:"confirm",76:"confirm",53:"cancel",48:flags.contains(.shift) ? "previous":"next",51:"delete",117:"delete"][Int(event.keyCode)]
        }
        if let shortcut = shortcut {
            flush()
            guard var action = snapshot(focusPoint,action:"shortcut") else { return }
            action.event["shortcut"] = shortcut
            action.event.removeValue(forKey:"target")
            pending = action;flush();return
        }
        // Focused editable-control interaction only; no key characters, values or clipboard reads.
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),kAXFocusedUIElementAttribute as CFString,&value) == .success,
              let value = value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return }
        let element = value as! AXUIElement
        guard ["AXTextField","AXTextArea","AXComboBox"].contains(text(element,kAXRoleAttribute as CFString)) else { return }
        if pending?.event["action"] as? String != "fill" {
            flush()
            guard var action = snapshot(focusPoint,action:"fill") else { return }
            action.event.removeValue(forKey:"label");action.event.removeValue(forKey:"target")
            pending = action
        }
        schedule(0.7)
    }
    func schedule(_ interval: TimeInterval) {
        pendingTimer?.invalidate()
        pendingTimer = Timer.scheduledTimer(withTimeInterval:interval,repeats:false) { [weak self] _ in MainActor.assumeIsolated { self?.flush() } }
    }
    func flush() {
        pendingTimer?.invalidate();pendingTimer = nil
        guard var action = pending else { return };pending = nil
        let bitmap = NSBitmapImageRep(cgImage:action.image)
        var encoded: Data?
        for quality in [0.95,0.8,0.65,0.45] {
            if let bytes = bitmap.representation(using:.jpeg,properties:[.compressionFactor:quality]),bytes.count <= 700000 { encoded = bytes;break }
        }
        guard let encoded = encoded else { send(["type":"issue","reason":"A desktop screenshot exceeds the capture limit. The action is missing; review it before sharing."]);if !stopped { stop() };return }
        action.event["image"] = ["mediaType":"image/jpeg","data":encoded.base64EncodedString()]
        send(action.event)
    }
}

let args = CommandLine.arguments
if args.count == 2 && args[1] == "probe" {
    send(["type": "permissions", "screen": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()])
    exit(0)
}
guard args.count >= 2, ["list","record","record-desktop"].contains(args[1]) else { fail("Use list, probe, or record with the selected window ID.") }
guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else { fail("Screen Recording permission is required. In System Settings → Privacy & Security → Screen Recording, enable the application named in the macOS permission request, then quit and reopen it before retrying.") }
let recording = args[1] == "record" || args[1] == "record-desktop"
if recording && !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
    fail("Accessibility permission is required for control labels. In System Settings → Privacy & Security → Accessibility, enable the application named in the macOS permission request, then retry.")
}
NSApplication.shared.setActivationPolicy(.prohibited)
var recorder: Recorder?
var workflowRecorder: WorkflowRecorder?
Task { @MainActor in
    if args[1] == "record-desktop" { workflowRecorder = WorkflowRecorder();await workflowRecorder!.start();return }
    do {
        let available = try await content()
        let windows = available.windows.filter(permitted)
        if !recording {
            send(["type": "windows", "windows": windows.map { ["id": $0.windowID, "application": applicationContext($0.owningApplication!)?.name ?? "", "pid": $0.owningApplication!.processID, "title": String(($0.title ?? "Untitled window").prefix(200))] }])
            exit(0)
        }
        guard args.count == 4, let id = UInt32(args[2]), let pid = Int32(args[3]), let window = windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == pid }) else { fail("The selected window is unavailable. Refresh the window list and select it again.") }
        recorder = Recorder(window: window)
        recorder!.start()
    } catch { fail("Windows could not be listed. Check Screen Recording permission and retry.") }
}
NSApplication.shared.run()
