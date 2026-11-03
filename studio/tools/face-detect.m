// Face detection via Apple's Vision framework (Objective-C, so it builds against whatever
// SDK the command-line tools ship).
//
// Reports the face box AND the face contour: the chin is a landmark, not the bottom of a
// bounding box (which includes hair and neck), and "captions below the chin" needs that.
//
// Usage: face-detect <video> [--fps 3] [--start 0] [--duration N]
// Output: JSON — { width, height, sampleEveryMs, detector, frames: [{ atMs, faces: [...] }] }
// Coordinates: top-left origin, pixels of the video as displayed.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Vision/Vision.h>

static NSString *argValue(NSString *name, NSString *fallback) {
    NSArray<NSString *> *a = NSProcessInfo.processInfo.arguments;
    NSUInteger i = [a indexOfObject:[@"--" stringByAppendingString:name]];
    return (i != NSNotFound && i + 1 < a.count) ? a[i + 1] : fallback;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "usage: face-detect <video> [--fps 3] [--start 0] [--duration N]\n"); return 2; }
        NSString *path = [NSString stringWithUTF8String:argv[1]];
        if ([path hasPrefix:@"--"]) { fprintf(stderr, "expected a video path\n"); return 2; }
        double fps = [argValue(@"fps", @"3") doubleValue];
        if (fps <= 0) fps = 3;
        double start = [argValue(@"start", @"0") doubleValue];
        double durationArg = [argValue(@"duration", @"-1") doubleValue];

        NSURL *url = [NSURL fileURLWithPath:path];
        AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
        AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
        if (track == nil) { fprintf(stderr, "no video track\n"); return 2; }

        CGSize natural = CGSizeApplyAffineTransform(track.naturalSize, track.preferredTransform);
        int vw = (int)lround(fabs(natural.width));
        int vh = (int)lround(fabs(natural.height));
        double assetSeconds = CMTimeGetSeconds(asset.duration);
        double windowEnd = durationArg > 0 ? MIN(assetSeconds, start + durationArg) : assetSeconds;

        AVAssetImageGenerator *gen = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
        gen.appliesPreferredTrackTransform = YES;
        gen.requestedTimeToleranceBefore = kCMTimeZero;
        gen.requestedTimeToleranceAfter = kCMTimeZero;
        gen.maximumSize = CGSizeMake(1280, 1280);

        double step = 1.0 / MAX(0.5, fps);
        NSMutableArray *frames = [NSMutableArray array];
        int failures = 0;
        for (double t = start; t < windowEnd; t += step) {
            CMTime time = CMTimeMakeWithSeconds(t, 600);
            NSError *err = nil;
            CGImageRef cg = [gen copyCGImageAtTime:time actualTime:NULL error:&err];
            if (cg == NULL) { failures++; continue; }
            VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
            VNDetectFaceLandmarksRequest *req = [[VNDetectFaceLandmarksRequest alloc] init];
            NSError *perr = nil;
            [handler performRequests:@[req] error:&perr];
            CGImageRelease(cg);

            NSMutableArray *faces = [NSMutableArray array];
            for (VNFaceObservation *obs in req.results ?: @[]) {
                CGRect bb = obs.boundingBox;   // normalized, bottom-left origin
                double x = bb.origin.x * vw;
                double y = (1.0 - bb.origin.y - bb.size.height) * vh;
                double w = bb.size.width * vw;
                double h = bb.size.height * vh;
                double chinX = x + w / 2.0, chinY = y + h;
                VNFaceLandmarkRegion2D *contour = obs.landmarks.faceContour;
                // Vision landmark space is ALSO bottom-left origin, so the chin is the
                // point with the SMALLEST normalized y. (Taking the largest reports the
                // forehead — a mistake that puts captions on someone's face.)
                if (contour != nil && contour.pointCount > 0) {
                    double lowest = 2.0;
                    for (NSUInteger i = 0; i < contour.pointCount; i++) {
                        CGPoint p = contour.normalizedPoints[i];
                        if (p.y < lowest) {
                            lowest = p.y;
                            chinX = (bb.origin.x + p.x * bb.size.width) * vw;
                            chinY = (1.0 - (bb.origin.y + p.y * bb.size.height)) * vh;
                        }
                    }
                }
                [faces addObject:@{
                    @"x": @(x), @"y": @(y), @"w": @(w), @"h": @(h),
                    @"chinX": @(chinX), @"chinY": @(chinY),
                    @"conf": @(obs.confidence),
                }];
            }
            [frames addObject:@{ @"atMs": @((int)llround(t * 1000.0)), @"faces": faces }];
        }

        NSDictionary *doc = @{
            @"width": @(vw), @"height": @(vh),
            @"sampleEveryMs": @((int)llround(step * 1000.0)),
            @"detector": @"Vision VNDetectFaceLandmarksRequest",
            @"decodedFrames": @((int)frames.count),
            @"decodeFailures": @(failures),
            @"frames": frames,
        };
        NSData *json = [NSJSONSerialization dataWithJSONObject:doc options:0 error:nil];
        fwrite(json.bytes, 1, json.length, stdout);
        return 0;
    }
}
