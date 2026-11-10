import Foundation
import AppKit
import Vision

let path=CommandLine.arguments[1]
let value=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:path))) as! [String:Any]
let guide=value["guide"] as! [String:Any],steps=guide["steps"] as! [[String:Any]],assets=value["assets"] as! [String:[String:Any]]
var expected=[(0,"Open settings"),(1,"Workflow"),(2,"Open dialog"),(3,"Confirm dialog"),(9,"Context action")]
if let index=steps.firstIndex(where:{ (($0["source"] as? [String:Any])?["application"] as? String ?? "").contains("Chrome") }) { expected.append((index,"Continue desktop workflow")) }
var results:[[String:Any]]=[]
for (index,label) in expected {
 let step=steps[index],asset=assets[step["asset"] as! String]!,bytes=Data(base64Encoded:asset["data"] as! String)!
 guard let bitmap=NSBitmapImageRep(data:bytes),let image=bitmap.cgImage else { fatalError("The controlled desktop screenshot is unreadable.") }
 let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate;request.usesLanguageCorrection=false
 try VNImageRequestHandler(cgImage:image).perform([request])
 let matches=(request.results ?? []).filter { $0.topCandidates(1).first?.string.lowercased().contains(label.lowercased()) == true }
 let boxes=(step["annotations"] as! [[String:Any]]).filter { $0["type"] as? String == "box" }
 let aligned=index==9 || matches.contains { row in
  let center=CGPoint(x:row.boundingBox.midX,y:1-row.boundingBox.midY)
  return boxes.contains { b in
   CGRect(x:b["x"] as! Double,y:b["y"] as! Double,width:b["width"] as! Double,height:b["height"] as! Double).insetBy(dx:-0.01,dy:-0.01).contains(center)
  }
 }
 guard !matches.isEmpty,aligned else {
  print(String(data:try JSONSerialization.data(withJSONObject:["passed":false,"step":index+1,"textVisible":!matches.isEmpty,"targetAligned":aligned]),encoding:.utf8)!)
  exit(1)
 }
 results.append(["step":index+1,"textVisible":true,"targetAligned":aligned,"pixels":[image.width,image.height]])
}
print(String(data:try JSONSerialization.data(withJSONObject:["passed":true,"checks":results],options:[.sortedKeys]),encoding:.utf8)!)
