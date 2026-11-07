import Foundation
import PDFKit
import AppKit
let args = CommandLine.arguments
 guard args.count == 3, let document = PDFDocument(url: URL(fileURLWithPath: args[1])), let page = document.page(at: 0) else { fatalError("Open a readable exported PDF and supply a PNG preview path.") }
let bounds = page.bounds(for: .mediaBox)
let image = page.thumbnail(of: NSSize(width: bounds.width, height: bounds.height), for: .mediaBox)
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("PDF page could not be rendered independently.") }
try png.write(to: URL(fileURLWithPath: args[2]))
let result: [String: Any] = ["pages": document.pageCount, "text": document.string ?? "", "rendered": true]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
