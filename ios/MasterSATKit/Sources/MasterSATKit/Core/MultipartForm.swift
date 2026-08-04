import Foundation

/// A `multipart/form-data` body, built in memory.
///
/// In memory on purpose: the platform caps a homework submission well below the point
/// where streaming from disk would matter, and an in-memory body is what lets a retry send
/// byte-identical content — which is what makes the per-file upload tokens actually
/// deduplicate instead of quietly uploading twice.
public struct MultipartForm: Sendable {
    public struct File: Sendable {
        public let field: String
        public let filename: String
        public let mimeType: String
        public let data: Data
        /// Stable per-file token. The server skips a file whose token it has already
        /// stored for this submission, so a retry after a timeout cannot duplicate it.
        public let token: String

        public init(
            field: String = "files",
            filename: String,
            mimeType: String,
            data: Data,
            token: String = UUID().uuidString
        ) {
            self.field = field
            self.filename = filename
            self.mimeType = mimeType
            self.data = data
            self.token = token
        }
    }

    public private(set) var fields: [(name: String, value: String)] = []
    public private(set) var files: [File] = []
    public let boundary: String

    public init(boundary: String = "masterSAT.\(UUID().uuidString)") {
        self.boundary = boundary
    }

    public mutating func add(_ name: String, _ value: String) {
        fields.append((name, value))
    }

    public mutating func add(_ name: String, _ value: Int) {
        fields.append((name, String(value)))
    }

    public mutating func add(file: File) {
        files.append(file)
    }

    public var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    /// What an image's bytes actually are.
    ///
    /// The photo picker hands back the original file — a screenshot is a PNG, a photo is
    /// a JPEG, a recent iPhone shot may be HEIC. Labelling everything `.jpg` gives the
    /// server a name that disagrees with the content, and the server validates uploads by
    /// extension: a HEIC called `.jpg` passes the check and then fails to open for the
    /// teacher.
    public static func imageKind(for data: Data) -> (extension: String, mimeType: String) {
        let bytes = [UInt8](data.prefix(12))
        func matches(_ prefix: [UInt8]) -> Bool {
            bytes.count >= prefix.count && Array(bytes.prefix(prefix.count)) == prefix
        }
        if matches([0x89, 0x50, 0x4E, 0x47]) { return ("png", "image/png") }
        if matches([0xFF, 0xD8, 0xFF]) { return ("jpg", "image/jpeg") }
        if matches([0x47, 0x49, 0x46]) { return ("gif", "image/gif") }
        if bytes.count >= 12, Array(bytes[4..<8]) == [0x66, 0x74, 0x79, 0x70] {
            // ISO base media: HEIC and friends both start `....ftyp`.
            let brand = String(decoding: bytes[8..<12], as: UTF8.self)
            if brand.hasPrefix("hei") || brand.hasPrefix("mif") { return ("heic", "image/heic") }
        }
        if bytes.count >= 12, matches([0x52, 0x49, 0x46, 0x46]),
           Array(bytes[8..<12]) == [0x57, 0x45, 0x42, 0x50] {
            return ("webp", "image/webp")
        }
        // Unknown: call it a JPEG, which is what a camera roll item almost always is, and
        // let the server's own validation have the final say.
        return ("jpg", "image/jpeg")
    }

    public func encoded() -> Data {
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        for field in fields {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(field.name)\"\r\n\r\n")
            append("\(field.value)\r\n")
        }
        for file in files {
            append("--\(boundary)\r\n")
            // Quotes in a filename would end the header value early; strip rather than
            // escape, since a filename is cosmetic here and the token is the identity.
            let safeName = file.filename.replacingOccurrences(of: "\"", with: "")
            append("Content-Disposition: form-data; name=\"\(file.field)\"; filename=\"\(safeName)\"\r\n")
            append("Content-Type: \(file.mimeType)\r\n\r\n")
            body.append(file.data)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        return body
    }
}
