import Foundation
import Vision
import AppKit
for file in CommandLine.arguments.dropFirst() {
 guard let image = NSImage(contentsOfFile:file), let cg = image.cgImage(forProposedRect:nil,context:nil,hints:nil) else {continue}
 let request = VNRecognizeTextRequest();request.recognitionLevel = .accurate;request.recognitionLanguages = ["fr-FR","en-US"];request.usesLanguageCorrection = true
 do {try VNImageRequestHandler(cgImage:cg,options:[:]).perform([request]);let result=(request.results ?? []).compactMap { o -> [String:Any]? in guard let t=o.topCandidates(1).first else{return nil};return ["text":t.string,"confidence":t.confidence,"x":o.boundingBox.minX,"y":o.boundingBox.minY] };let data=try JSONSerialization.data(withJSONObject:["file":file,"lines":result]);print(String(data:data,encoding:.utf8)!)} catch { print("{}") }
}
