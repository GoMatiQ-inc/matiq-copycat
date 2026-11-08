import AppKit
import ScreenCaptureKit
import ApplicationServices

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
func target(_ point: CGPoint, pid: pid_t, frame: CGRect) -> [String: Any] {
    var found: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &found) == .success,
          let element = found else { return [:] }
    var owner: pid_t = 0
    guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { return [:] }
    let roles = ["AXButton": "button", "AXLink": "link", "AXCheckBox": "checkbox", "AXRadioButton": "radio button", "AXPopUpButton": "dropdown", "AXMenuItem": "menu item"]
    let role = text(element, kAXRoleAttribute as CFString)
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
                    let application = AXUIElementCreateApplication(self.pid)
                    AXUIElementSetMessagingTimeout(application, 0.5)
                    var role: CFTypeRef?
                    let access = AXUIElementCopyAttributeValue(application, kAXRoleAttribute as CFString, &role)
                    if access == .apiDisabled {
                        self.stop("Accessibility permission was revoked. Capture stopped; restore permission before resuming.")
                        return
                    }
                    if access == .cannotComplete || access == .failure {
                        self.stop("The selected application's Accessibility context could not be checked. Capture stopped; check permissions and select the window again.")
                        return
                    }
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
            let context = target(point, pid: pid, frame: window.frame)
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            let scale = CGFloat(filter.pointPixelScale)
            config.width = max(1, Int(filter.contentRect.width * scale))
            config.height = max(1, Int(filter.contentRect.height * scale))
            guard config.width <= 32768 && config.height <= 32768 && Int64(config.width) * Int64(config.height) <= 32000000 else { stop("The selected window exceeds 32 megapixels. Reduce its size and explicitly resume."); return }
            config.ignoreShadowsSingleWindow = true
            config.includeChildWindows = false
            config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
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

let args = CommandLine.arguments
if args.count == 2 && args[1] == "probe" {
    send(["type": "permissions", "screen": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()])
    exit(0)
}
guard args.count >= 2, ["list","record"].contains(args[1]) else { fail("Use list, probe, or record with the selected window ID.") }
guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else { fail("Screen Recording permission is required. In System Settings → Privacy & Security → Screen Recording, enable the application named in the macOS permission request, then quit and reopen it before retrying.") }
let recording = args[1] == "record"
if recording && !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
    fail("Accessibility permission is required for control labels. In System Settings → Privacy & Security → Accessibility, enable the application named in the macOS permission request, then retry.")
}
NSApplication.shared.setActivationPolicy(.prohibited)
var recorder: Recorder?
Task { @MainActor in
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
