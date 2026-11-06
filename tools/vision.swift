// OCR + face landmarks on sampled frames (Apple Vision). usage: vision <dir of jpg> <out.json>
// Output per frame: { texts: [{text, conf, x, y, w, h}], face, eyes, mouth } in pixels, y down.
import Foundation
import Vision
import CoreImage

let a = CommandLine.arguments
guard a.count == 3 else { print("usage: vision <dir> <out.json>"); exit(1) }
let dir = URL(fileURLWithPath: a[1])
let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()

func box(_ b: CGRect, _ W: Double, _ H: Double) -> [String: Double] {
  ["x": Double(b.minX) * W, "y": (1 - Double(b.maxY)) * H, "w": Double(b.width) * W, "h": Double(b.height) * H]
}
func regionBox(_ r: VNFaceLandmarkRegion2D?, _ face: VNFaceObservation, _ W: Double, _ H: Double) -> [String: Double]? {
  guard let pts = r?.normalizedPoints, !pts.isEmpty else { return nil }
  let f = face.boundingBox
  let xs = pts.map { Double(f.minX) + Double($0.x) * Double(f.width) }
  let ys = pts.map { Double(f.minY) + Double($0.y) * Double(f.height) }
  return box(CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!), W, H)
}

var out: [[String: Any]] = []
for f in files {
  guard let img = CIImage(contentsOf: dir.appendingPathComponent(f)) else { out.append(["file": f, "texts": []]); continue }
  let W = Double(img.extent.width), H = Double(img.extent.height)
  let text = VNRecognizeTextRequest()
  text.recognitionLevel = .accurate
  text.recognitionLanguages = ["fr-FR", "en-US"]
  text.usesLanguageCorrection = false
  let faces = VNDetectFaceLandmarksRequest()
  try VNImageRequestHandler(ciImage: img, options: [:]).perform([text, faces])
  var row: [String: Any] = ["file": f]
  row["texts"] = (text.results ?? []).compactMap { o -> [String: Any]? in
    guard let c = o.topCandidates(1).first else { return nil }
    var t: [String: Any] = box(o.boundingBox, W, H)
    t["text"] = c.string
    t["conf"] = Double(c.confidence)
    return t
  }
  if let face = (faces.results ?? []).max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
    row["face"] = box(face.boundingBox, W, H)
    if let m = regionBox(face.landmarks?.outerLips, face, W, H) { row["mouth"] = m }
    let eyes = [regionBox(face.landmarks?.leftEye, face, W, H), regionBox(face.landmarks?.rightEye, face, W, H)].compactMap { $0 }
    row["eyes"] = eyes
  }
  out.append(row)
}
try JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: a[2]))
