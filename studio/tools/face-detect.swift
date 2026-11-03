// Face detection for the video pipeline, via Apple's Vision framework.
//
// Why native: no model download, no Python environment, and the same framework also
// provides person segmentation for the background work later. It reports the face box AND
// the face contour, which is what makes "captions below the chin" possible — the bottom of
// a bounding box includes hair and neck, the chin is a real landmark.
//
// Usage: face-detect <video> [--fps 3] [--start 0] [--duration N]
// Output: JSON to stdout — { width, height, sampleEveryMs, frames: [{ atMs, faces: [...] }] }
import AVFoundation
import Foundation
import Vision
import CoreGraphics

struct FaceOut: Codable {
    let x: Double, y: Double, w: Double, h: Double   // top-left origin, pixels of the video
    let chinX: Double, chinY: Double                 // lowest contour point, top-left origin
    let conf: Double
    let roll: Double
}

struct FrameOut: Codable {
    let atMs: Int
    let faces: [FaceOut]
}

struct Doc: Codable {
    let width: Int
    let height: Int
    let sampleEveryMs: Int
    let detector: String
    let frames: [FrameOut]
}

func argValue(_ name: String, _ fallback: String) -> String {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: "--\(name)"), i + 1 < a.count { return a[i + 1] }
    return fallback
}

let args = CommandLine.arguments
guard args.count > 1, !args[1].hasPrefix("--") else {
    FileHandle.standardError.write("usage: face-detect <video> [--fps 3] [--start 0] [--duration N]\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: args[1])
let fps = Double(argValue("fps", "3")) ?? 3
let start = Double(argValue("start", "0")) ?? 0
let durationArg = Double(argValue("duration", "-1")) ?? -1

let asset = AVURLAsset(url: url)
guard let track = asset.tracks(withMediaType: .video).first else {
    FileHandle.standardError.write("no video track\n".data(using: .utf8)!)
    exit(2)
}
let natural = track.naturalSize.applying(track.preferredTransform)
let vw = Int(abs(natural.width).rounded()), vh = Int(abs(natural.height).rounded())
let assetSeconds = CMTimeGetSeconds(asset.duration)
let windowEnd = durationArg > 0 ? min(assetSeconds, start + durationArg) : assetSeconds

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 1280, height: 1280)   // enough for detection, fast to decode

let step = 1.0 / max(0.5, fps)
var frames: [FrameOut] = []
var t = start
while t < windowEnd {
    let time = CMTime(seconds: t, preferredTimescale: 600)
    guard let cg = try? gen.copyCGImage(at: time, actualTime: nil) else { t += step; continue }
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    let request = VNDetectFaceLandmarksRequest()
    do { try handler.perform([request]) } catch { t += step; continue }

    var faces: [FaceOut] = []
    for obs in (request.results ?? []) {
        let bb = obs.boundingBox    // normalized, bottom-left origin
        let x = bb.origin.x * Double(vw)
        let y = (1 - bb.origin.y - bb.height) * Double(vh)
        let w = bb.width * Double(vw)
        let h = bb.height * Double(vh)
        // Chin: the face contour point closest to the bottom of the image (largest Vision y).
        var chinX = x + w / 2, chinY = y + h
        if let contour = obs.landmarks?.faceContour {
            let pts = contour.normalizedPoints
            if let lowest = pts.max(by: { $0.y < $1.y }) {
                chinX = (bb.origin.x + Double(lowest.x) * bb.width) * Double(vw)
                chinY = (1 - (bb.origin.y + Double(lowest.y) * bb.height)) * Double(vh)
            }
        }
        faces.append(FaceOut(x: x, y: y, w: w, h: h, chinX: chinX, chinY: chinY,
                             conf: Double(obs.confidence), roll: Double(obs.roll?.doubleValue ?? 0)))
    }
    frames.append(FrameOut(atMs: Int((t * 1000).rounded()), faces: faces))
    t += step
}

let doc = Doc(width: vw, height: vh, sampleEveryMs: Int((step * 1000).rounded()),
              detector: "Vision VNDetectFaceLandmarksRequest", frames: frames)
let enc = JSONEncoder()
enc.outputFormatting = [.withoutEscapingSlashes]
FileHandle.standardOutput.write(try! enc.encode(doc))
