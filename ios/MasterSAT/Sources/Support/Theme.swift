import SwiftUI
import MasterSATKit

/// The platform's design tokens, ported from the web's `globals.css`.
///
/// Values are copied, not approximated — a student moving between phone and laptop should
/// see one product, and "close enough" blue reads as a different app. Every colour has a
/// dark counterpart because the web ships one and iOS switches without asking.
enum Theme {
    /// Brand blue. `#2a68c0` in light, `#3170d6` in dark — the web lifts it there because
    /// the deep blue disappears against a dark surface, but it stays the SAME blue. Dark mode
    /// used to switch to an indigo (`#4b5ce6`); the site dropped that, and a student moving
    /// between the two at night should not see two brands.
    static let accent = dynamic(light: 0x2a68c0, dark: 0x3170d6)
    static let accentHover = dynamic(light: 0x21539e, dark: 0x5b8def)
    /// Brand-blue TEXT on a card — the web's `text-primary dark:text-primary-hover`. On the
    /// near-black dark surface the brand blue falls under 4.5:1; its hover shade clears it.
    static let accentText = dynamic(light: 0x2a68c0, dark: 0x5b8def)
    static let accentSoft = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.192, green: 0.439, blue: 0.839, alpha: 0.18)
        : UIColor(red: 0.165, green: 0.408, blue: 0.753, alpha: 0.10) })

    /// `--dz-indigo-deep` — the countdown panel's own background. It is NOT `accentHover`:
    /// the web darkens it in dark mode (`#1f4f96`) where the hover blue lightens, because a
    /// panel that fills a card has to sit behind white text either way.
    static let accentDeep = dynamic(light: 0x21539e, dark: 0x1f4f96)

    static let success = dynamic(light: 0x059669, dark: 0x34d399)
    static let warning = dynamic(light: 0xd97706, dark: 0xfbbf24)
    static let danger = dynamic(light: 0xdc2626, dark: 0xf87171)
    static let info = dynamic(light: 0x0284c7, dark: 0x38bdf8)

    /// Fills under white type, the light-mode shade in both schemes. The semantic colours lift
    /// in dark mode so they read as text on a dark card; under white a 10-pt badge on the lifted
    /// red or purple falls to about 3:1, where the light shades hold 4.8:1 and 6.1:1.
    static let dangerFill = dynamic(light: 0xdc2626, dark: 0xdc2626)
    static let subjectEnglishFill = dynamic(light: 0x6d4ec7, dark: 0x6d4ec7)

    /// `--dz-amber`. A shade brighter than `warning`, and deliberately so: on the calendar
    /// and the assessments board it is a *category* (a test, work in flight), not a caution.
    static let amber = dynamic(light: 0xf59e0b, dark: 0xfbbf24)
    static let amberSoft = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(hex: 0xfbbf24).withAlphaComponent(0.15)
        : UIColor(hex: 0xf59e0b).withAlphaComponent(0.13) })

    /// The board colours a card by its subject — maths blue, English purple — so a student
    /// can tell two pieces of work apart before reading either title.
    static let subjectEnglish = dynamic(light: 0x6d4ec7, dark: 0x9f86e8)
    /// Maths is the brand blue — the board already colours it so; named for call sites.
    static let subjectMath = accent
    /// Words carry the amber of the vocabulary hub.
    static let subjectWords = amber
    /// The streak's flame orange.
    static let strike = dynamic(light: 0xea580c, dark: 0xfb923c)
    /// A card's edge: nothing in light mode (the shadow separates it), a faint line in dark,
    /// where a shadow cannot be seen.
    static let cardEdge = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor.white.withAlphaComponent(0.08) : UIColor.clear })

    static let successSoft = soft(success)
    static let warningSoft = soft(warning)
    static let dangerSoft = soft(danger)
    static let infoSoft = soft(info)

    /// Page background. The web's `--bg` is pure white in light mode with cards on
    /// `--surface` (#f8fafc); iOS reads better with the inverse, so the page takes the
    /// grouped background and cards stay white.
    static let background = Color(.systemGroupedBackground)
    static let card = Color(.secondarySystemGroupedBackground)
    static let surface2 = Color(.tertiarySystemFill)
    static let separator = Color(.separator)

    static let textSecondary = Color(.secondaryLabel)
    /// `--text-label` — the small-caps overline colour.
    static let textLabel = Color(.tertiaryLabel)

    /// The page's ink as a fill — black in light mode, white in dark — and the text
    /// that sits on it. Always together: white text on `Color.primary` is white on white in dark
    /// mode, where this pair turns the fill light and the text dark.
    static let ink = Color(.label)
    static let onInk = Color(.systemBackground)

    /// The exam/runner chrome is deliberately plain: nothing on a question screen should
    /// compete with the question.
    static let examBackground = Color(.systemBackground)
    static let examChrome = Color(.secondarySystemBackground)

    static let flagged = dynamic(light: 0xd97706, dark: 0xfbbf24)

    /// Under five minutes a timer turns urgent. Matching the web matters: a student
    /// trained on one should not have to re-learn the other mid-exam.
    static let timerUrgent = danger
    static let timerUrgentThreshold: TimeInterval = 5 * 60

    /// The web uses one radius family: 12 for controls, 18 for cards, 24 for hero panels.
    enum Radius {
        static let control: CGFloat = 12
        static let card: CGFloat = 18
        static let hero: CGFloat = 24
    }

    private static func dynamic(light: Int, dark: Int) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    /// A 12%-alpha wash of a semantic colour — the web's `*-soft` tokens.
    private static func soft(_ colour: Color) -> Color { colour.opacity(0.12) }
}

private extension UIColor {
    convenience init(hex: Int) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

// MARK: - Building blocks

extension View {
    /// The web's card: a white surface, a hairline border, one soft shadow.
    ///
    /// Cards must claim the full width. A `ScrollView` sizes itself to its content, so
    /// cards that only take the width of their own text drag the whole navigation area in
    /// with them — which is how the dashboard once ended up in a narrow centre column with
    /// its title clipped to a single letter.
    func cardStyle(padding: CGFloat = 16) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.cardEdge, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 3)
    }

    /// A bar of `tone` along a card's top edge — what the card is about, readable before a word of
    /// it. Goes after `cardStyle`. It clips only itself to the card's corners, so the card's
    /// shadow is not cut off the way clipping the whole card would cut it. Any fill will do: the
    /// Me sheet's hero runs the page's three colours along its edge as a gradient.
    func cardToneBar<Tone: ShapeStyle>(_ tone: Tone, height: CGFloat = 3) -> some View {
        overlay(alignment: .top) {
            Color.clear
                .overlay(alignment: .top) { Rectangle().fill(tone).frame(height: height) }
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

/// The web's `.ds-overline` — a small-caps section label with wide tracking.
struct Overline: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .appFont(11, weight: .bold)
            .tracking(1.2)
            .foregroundStyle(Theme.textLabel)
    }
}

/// A status chip. The web uses these everywhere a state needs naming.
struct Chip: View {
    enum Tone { case neutral, accent, success, warning, danger, info }

    let text: String
    var icon: String?
    var tone: Tone = .neutral

    private var colour: Color {
        switch tone {
        case .neutral: return Theme.textSecondary
        case .accent: return Theme.accent
        case .success: return Theme.success
        case .warning: return Theme.warning
        case .danger: return Theme.danger
        case .info: return Theme.info
        }
    }

    private var fill: Color {
        tone == .neutral ? Theme.surface2 : colour.opacity(0.12)
    }

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).appFont(10, weight: .bold).accessibilityHidden(true) }
            Text(text).appFont(12, weight: .bold, design: .rounded)
        }
        .foregroundStyle(colour)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(fill))
    }
}

/// The web's primary button, at the size a thumb wants.
struct PrimaryButtonStyle: ButtonStyle {
    var tone: Color = Theme.accent
    /// The label's colour. White on every coloured tone; a tone that turns light in dark mode
    /// brings its own (`Theme.ink` takes `Theme.onInk`).
    var text: Color = .white
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(15, weight: .bold)
            .foregroundStyle(text)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(tone.opacity(configuration.isPressed ? 0.82 : 1))
            )
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.94)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(15, weight: .bold)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(configuration.isPressed ? Theme.accentSoft : Theme.surface2)
            )
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.94)
    }
}

/// A progress bar in the web's proportions — 6pt, fully rounded, soft track.
struct Bar: View {
    let fraction: Double
    var tone: Color = Theme.accent
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule()
                    .fill(tone)
                    // Guarded: a set with no words would divide by zero and SwiftUI draws
                    // a NaN width as nothing at all.
                    .frame(width: geometry.size.width * min(max(fraction.isFinite ? fraction : 0, 0), 1))
            }
        }
        .frame(height: height)
    }
}

extension String {
    /// A subject as a person writes it: `READING_WRITING` → `Reading Writing`.
    ///
    /// The API's casing differs per app (`READING_WRITING`, `Reading_Writing`, `MATH`), so
    /// normalise rather than trusting any one of them.
    var humanisedSubject: String {
        replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}

/// SAT scores, written the way a score is written.
///
/// `Text("\(score)")` interpolates into a `LocalizedStringKey` and formats the number for
/// the current locale — so 1450 renders as "1,450", or "1 450" in Uzbek. A section or
/// total score is an identifier, not a quantity; it never carries a thousands separator.
enum ScoreText {
    static func string(_ value: Int) -> String { String(value) }
    static func string(_ value: Double) -> String { String(Int(value.rounded())) }
    static func string(_ value: Int?) -> String { value.map(String.init) ?? "—" }
    static func string(_ value: Double?) -> String { value.map { String(Int($0.rounded())) } ?? "—" }
}

/// Status wording shown to students.
///
/// Nothing here reads as a punishment. A student who has not started something is "Not
/// started", never "Missing" or "Failed" — the app names the state, and never the student.
enum StatusLabel {
    static func homework(_ workflowStatus: String?) -> String {
        switch (workflowStatus ?? "").lowercased() {
        case "graded", "reviewed": return "Reviewed"
        case "submitted": return "Submitted"
        // Words only (`HomeworkStatus`): every set played, nothing handed in.
        case HomeworkStatus.completed: return "Completed"
        case "returned": return "Ready to revise"
        case "in_progress": return "In progress"
        default: return "Not started"
        }
    }

    static func tone(_ workflowStatus: String?) -> Chip.Tone {
        switch (workflowStatus ?? "").lowercased() {
        case "graded", "reviewed", HomeworkStatus.completed: return .success
        case "submitted": return .accent
        case "returned": return .warning
        default: return .neutral
        }
    }

    static func color(_ workflowStatus: String?) -> Color {
        switch (workflowStatus ?? "").lowercased() {
        case "graded", "reviewed", HomeworkStatus.completed: return Theme.success
        case "submitted": return Theme.accent
        case "returned": return Theme.warning
        default: return Theme.textSecondary
        }
    }
}
