import Foundation
import Darwin

struct BridgeFailure: Error { let message: String }
let maximumFrame = 1024 * 1024
let outputLock = NSLock()
func exactRead(_ fd: Int32, _ count: Int) throws -> Data? {
    var result = Data(count: count)
    var offset = 0
    while offset < count {
        let amount = result.withUnsafeMutableBytes { bytes in Darwin.read(fd, bytes.baseAddress!.advanced(by: offset), count - offset) }
        if amount == 0 { if offset == 0 { return nil }; throw BridgeFailure(message: "The connection ended inside a message. Reconnect before recording.") }
        if amount < 0 { if errno == EINTR { continue }; throw BridgeFailure(message: "The local connection could not be read. Reconnect before recording.") }
        offset += amount
    }
    return result
}
func writeAll(_ fd: Int32, _ bytes: Data) throws {
    var offset = 0
    while offset < bytes.count {
        let amount = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!.advanced(by: offset), bytes.count - offset) }
        if amount < 0 { if errno == EINTR { continue }; throw BridgeFailure(message: "The local connection closed. Reconnect before recording.") }
        if amount == 0 { throw BridgeFailure(message: "The local connection stopped accepting messages.") }
        offset += amount
    }
}
func readFrame(_ fd: Int32) throws -> Data? {
    guard let header = try exactRead(fd, 4) else { return nil }
    let count = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
    guard count > 0 && count <= UInt32(maximumFrame) else { throw BridgeFailure(message: "Message limit exceeded. Update the extension and tool together.") }
    guard let body = try exactRead(fd, Int(count)), let value = try JSONSerialization.jsonObject(with: body) as? [String: Any], value["v"] as? Int == 1 else { throw BridgeFailure(message: "Unsupported protocol. Update the extension and tool together.") }
    return header + body
}
func encode(_ value: [String: Any]) throws -> Data {
    let body = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard body.count <= UInt32(maximumFrame) else { throw BridgeFailure(message: "Message limit exceeded.") }
    var count = UInt32(body.count).littleEndian
    return withUnsafeBytes(of: &count) { Data($0) } + body
}
func secureFile(_ location: String) throws {
    var info = stat()
    guard lstat(location, &info) == 0, info.st_uid == getuid(), (info.st_mode & S_IFMT) == S_IFREG, info.st_mode & 0o077 == 0, info.st_size <= 4096 else { throw BridgeFailure(message: "Open MatiQ Guides and enable the approved browser bridge. Its private connection record is unavailable.") }
}
func run() throws {
    signal(SIGPIPE, SIG_IGN)
    let home = FileManager.default.homeDirectoryForCurrentUser
    let root = home.appendingPathComponent("Library/Application Support/MatiQ Solutions/Guides Bridge", isDirectory: true)
    let descriptor = root.appendingPathComponent("active.json").path
    try secureFile(descriptor)
    guard let record = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: descriptor))) as? [String: Any], record["v"] as? Int == 1,
          let socketPath = record["socket"] as? String, socketPath.hasPrefix(root.path + "/g-"), !socketPath.contains("/../"),
          let token = record["token"] as? String, token.count == 64,
          let origin = CommandLine.arguments.dropFirst().first(where: { $0.hasPrefix("chrome-extension://") || $0 == "guides@matiqinc.com" }) else {
        throw BridgeFailure(message: "The browser identity or connection record is incompatible. Reinstall the approved Guides bridge and extension.")
    }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard socketPath.utf8.count < capacity else { throw BridgeFailure(message: "The local bridge path is too long. Contact support with your application location.") }
    withUnsafeMutablePointer(to: &address.sun_path) { pointer in
        pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { destination in
            socketPath.withCString { source in _ = strlcpy(destination, source, capacity) }
        }
    }
    let connection = socket(AF_UNIX, SOCK_STREAM, 0)
    guard connection >= 0 else { throw BridgeFailure(message: "The local bridge socket could not be created.") }
    defer { shutdown(connection, SHUT_RDWR); close(connection) }
    let connected = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(connection, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    guard connected == 0 else { throw BridgeFailure(message: "The receiving Guides instance is unavailable. Open it, then reconnect from the extension.") }
    try writeAll(connection, encode(["v": 1, "type": "authenticate", "token": token, "origin": origin]))
    let reader = Thread {
        do {
            while let bytes = try readFrame(connection) { outputLock.lock(); defer { outputLock.unlock() }; try writeAll(STDOUT_FILENO, bytes) }
        } catch {
            outputLock.lock()
            if let failure = try? encode(["v": 1, "type": "error", "error": "The local bridge connection failed. Reconnect and review capture status before continuing."]) { try? writeAll(STDOUT_FILENO, failure) }
            outputLock.unlock()
            Darwin.exit(1)
        }
        Darwin.exit(0)
    }
    reader.start()
    while let bytes = try readFrame(STDIN_FILENO) { try writeAll(connection, bytes) }
}
do { try run() }
catch {
    let message = (error as? BridgeFailure)?.message ?? "The Guides bridge could not start. Reinstall its approved version and reconnect."
    outputLock.lock()
    if let bytes = try? encode(["v": 1, "type": "error", "error": message]) { try? writeAll(STDOUT_FILENO, bytes) }
    outputLock.unlock()
    Darwin.exit(1)
}
