import Foundation
import PDFKit
import AppKit
import Vision
let args = CommandLine.arguments
guard args.count == 3, let document = PDFDocument(url: URL(fileURLWithPath: args[1])), document.pageCount > 0 else { fatalError("Open a readable exported PDF and supply a PNG preview path.") }
var visibleText: [String] = []
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { fatalError("An exported PDF page is unavailable.") }
    let bounds = page.bounds(for: .mediaBox)
    let image = page.thumbnail(of: NSSize(width: bounds.width * 2, height: bounds.height * 2), for: .mediaBox)
    guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let pixels = bitmap.cgImage else { fatalError("PDF page could not be rendered independently.") }
    if index == 0 {
        guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Save the rendered PDF inspection preview.") }
        try png.write(to: URL(fileURLWithPath: args[2]))
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: pixels, options: [:]).perform([request])
    visibleText += (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}
let result: [String: Any] = ["pages": document.pageCount, "text": document.string ?? "", "visibleText": visibleText.joined(separator: "\n"), "rendered": true]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
