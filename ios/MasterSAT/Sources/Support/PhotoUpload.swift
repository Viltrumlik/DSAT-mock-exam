import UIKit
import MasterSATKit

/// Getting a photo from the camera roll ready to hand in.
enum PhotoUpload {
    /// Longest edge, in pixels. A 48-megapixel photo of a worksheet is 8064 px across and
    /// tens of megabytes; a teacher reads it just as well at this size, and a student on
    /// mobile data sends it in a fraction of the time.
    static let maxDimension: CGFloat = 3000

    /// Re-encode camera photos as JPEG, keeping everything else as it came.
    ///
    /// - HEIC is re-encoded because the server's allowlist refuses `.heic`.
    /// - JPEG is re-encoded because a camera JPEG carries EXIF, location included; a fresh
    ///   encode keeps the pixels and orientation and drops the rest.
    /// - PNG (screenshots), GIF and WebP carry no location and pass through untouched.
    static func prepare(_ data: Data) -> (Data, (extension: String, mimeType: String)) {
        let kind = MultipartForm.imageKind(for: data)
        guard kind.extension == "heic" || kind.extension == "jpg",
              let image = UIImage(data: data) else {
            return (data, kind)
        }
        let scaled = downscaled(image)
        guard let jpeg = scaled.jpegData(compressionQuality: 0.85) else { return (data, kind) }
        return (jpeg, ("jpg", "image/jpeg"))
    }

    private static func downscaled(_ image: UIImage) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height) * image.scale
        guard longest > maxDimension else { return image }
        let factor = maxDimension / longest
        let target = CGSize(width: size.width * image.scale * factor, height: size.height * image.scale * factor)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        // Drawing through the renderer also bakes the orientation into the pixels, so the
        // upload is upright wherever it is opened.
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
