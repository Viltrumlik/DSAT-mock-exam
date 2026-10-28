import SwiftUI
import MasterSATKit

/// The kit's level colours as SwiftUI colours. The Class tab's level cards and the class page
/// both read these, so the two never drift from the design's numbers.
extension Color {
    init(_ rgb: RGB, opacity: Double = 1) {
        let unit = rgb.unit
        self.init(.sRGB, red: unit.red, green: unit.green, blue: unit.blue, opacity: opacity)
    }
}

extension LevelPalette {
    /// The level card's fill — the design's `linear-gradient(135deg, start, end)`.
    var cardGradient: LinearGradient {
        LinearGradient(colors: [Color(start), Color(end)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension ClassTheme {
    /// The class page's background, top to bottom, darkening as it goes.
    var backgroundGradient: LinearGradient {
        LinearGradient(
            stops: background.map { Gradient.Stop(color: Color($0.color), location: $0.location) },
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
