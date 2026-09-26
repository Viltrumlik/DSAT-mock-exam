import SwiftUI
import MasterSATKit

// The furniture the Rewards area shares — Points, Leaderboard, Shop and their hub.
//
// Everything here is prefixed `Rewards…` because several features are being built in
// parallel in this module and SwiftUI views share one namespace.

// MARK: - The hero, with room for a body

/// The site's gradient hero (`PageHero`) with a slot under the blurb.
///
/// `HeroHeader` in PageChrome draws the same chrome but only takes label-and-number tiles.
/// The rewards pages put more than that inside the blue: the wallet tiles carry a line each
/// ("10 points = 1 coin"), the convert strip sits in the hero on the web, and so do the
/// leaderboard's scope tabs. The gradient, circles, eyebrow and type are copied from
/// `HeroHeader` exactly, so the two cannot be told apart on screen.
struct RewardsHero<Content: View>: View {
    let eyebrow: String
    let eyebrowIcon: String
    let title: String
    var blurb: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: eyebrowIcon).font(.system(size: 11, weight: .bold))
                Text(eyebrow).font(.system(size: 12, weight: .heavy))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 13)
            .padding(.vertical, 5)
            .background(Capsule().fill(.white.opacity(0.2)))

            Text(title)
                .font(.system(size: 28, weight: .heavy))
                .tracking(-0.7)
                .foregroundStyle(.white)
                .padding(.top, 14)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            if let blurb {
                Text(blurb)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.78))
                    .padding(.top, 10)
                    .fixedSize(horizontal: false, vertical: true)
            }

            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The circles go BEHIND the content here, not over it as on `HeroHeader`: this hero
        // holds a text field and buttons, and nothing decorative should sit on top of those.
        .background {
            ZStack {
                LinearGradient(
                    colors: [Theme.accent, Theme.accentHover],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Circle().fill(.white.opacity(0.06))
                    .frame(width: 210, height: 210)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .offset(x: 40, y: 60)
                Circle().fill(.white.opacity(0.05))
                    .frame(width: 150, height: 150)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .offset(x: 20, y: -70)
            }
            .allowsHitTesting(false)
        }
        .background(Theme.accent)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

/// A live total inside the hero — the same label-over-chip as `HeroHeader`'s tiles.
struct RewardsHeroStat: View {
    let label: String
    let icon: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.7)
                .foregroundStyle(.white.opacity(0.72))
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
                Text(value)
                    .font(.system(size: 17, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(.white.opacity(0.16)))
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The coins

/// The school's own minted art — `frontend/public/images/point-coin.png` (the silver token, a
/// score) and `reward-coin.png` (the blue coin, a currency). Copied into the asset catalogue,
/// not redrawn: a student should recognise the coin they see on the site.
struct RewardsCoinArt: View {
    enum Kind {
        case point, coin

        var asset: String { self == .point ? "RewardPoint" : "RewardCoin" }
        var name: String { self == .point ? "Point" : "Coin" }
    }

    let kind: Kind
    var size: CGFloat = 24

    var body: some View {
        Image(kind.asset)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            // Both coins are lit for a dark backdrop; on a light card they need a shadow of
            // their own, as on the web.
            .shadow(color: Color.black.opacity(0.28), radius: 1, x: 0, y: 1)
            .accessibilityHidden(true)
    }
}

// MARK: - States

/// A failed load, said as a failure — the web's `ErrorState`: a title, what it means for the
/// student, and a way to try again. Never an empty state: "nothing here" after a failure
/// reads as a student having earned nothing.
struct RewardsErrorState: View {
    let title: String
    let message: String
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    @State private var retrying = false

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 24))
                .foregroundStyle(Theme.warning)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task {
                    retrying = true
                    await retry()
                    retrying = false
                }
            } label: {
                if retrying {
                    ProgressView().frame(minWidth: 80)
                } else {
                    Text("Try again")
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(retrying)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .padding(.horizontal, 12)
    }
}

/// A short-lived message that lands where the student is looking — the web's toast. A line
/// printed at the top of a long shelf is out of sight of a Buy pressed twenty items down, and
/// a purchase nobody saw land is one a student presses again.
struct RewardsToastMessage: Identifiable, Equatable {
    enum Tone { case success, notice }

    let id = UUID()
    let tone: Tone
    let text: String
}

struct RewardsToast: View {
    let message: RewardsToastMessage

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: message.tone == .success ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(message.tone == .success ? Theme.success : Theme.warning)
                .accessibilityHidden(true)
            Text(message.text)
                .font(.system(size: 14, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.regularMaterial))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.12), radius: 12, x: 0, y: 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// Shows `message` at the bottom for four seconds, and reads it out.
    func rewardsToast(_ message: Binding<RewardsToastMessage?>) -> some View {
        overlay(alignment: .bottom) {
            if let current = message.wrappedValue {
                RewardsToast(message: current)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { message.wrappedValue = nil }
                    .task(id: current.id) {
                        AccessibilityNotification.Announcement(current.text).post()
                        try? await Task.sleep(for: .seconds(4))
                        guard !Task.isCancelled, message.wrappedValue?.id == current.id else { return }
                        message.wrappedValue = nil
                    }
            }
        }
        .animation(.spring(duration: 0.35), value: message.wrappedValue)
    }
}

// MARK: - Layout

/// Chips that wrap onto the next line — the leaderboard's filter groups, where a learning
/// center with twelve branches would otherwise run off the edge.
struct RewardsFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !row.indices.isEmpty, row.width + spacing + size.width > width {
                rows.append(row)
                row = Row()
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

// MARK: - Wording

enum RewardsDate {
    /// "Sep 25" — the web's `toLocaleDateString(undefined, {month: "short", day: "numeric"})`.
    static func short(_ iso: String) -> String {
        guard let date = JSONCoding.parseServerDate(iso) else { return "" }
        return formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return f
    }()
}

/// Colours that are not in `Theme` because only these pages use them. Solid colours on
/// purpose: gold is gold in either theme.
enum RewardsPalette {
    struct Medal {
        let solid: Color
        let top: Color
        let bottom: Color

        var fill: LinearGradient {
            // CSS `linear-gradient(160deg, …)`: mostly downward, leaning right.
            LinearGradient(colors: [top, bottom], startPoint: UnitPoint(x: 0.33, y: 0), endPoint: UnitPoint(x: 0.67, y: 1))
        }
    }

    /// Gold, silver, bronze — the classroom board's set, so a medal is one colour everywhere.
    static let gold = Medal(solid: Color(rewardsHex: 0xe3a008), top: Color(rewardsHex: 0xf5b740), bottom: Color(rewardsHex: 0xd98f0a))
    static let silver = Medal(solid: Color(rewardsHex: 0x94a3b8), top: Color(rewardsHex: 0xcbd5e1), bottom: Color(rewardsHex: 0x94a3b8))
    static let bronze = Medal(solid: Color(rewardsHex: 0xe0851a), top: Color(rewardsHex: 0xf4b15f), bottom: Color(rewardsHex: 0xe0851a))
    static let crown = Color(rewardsHex: 0xf5c542)

    /// Brand-blue TEXT on a card — the web's `text-primary dark:text-primary-hover`. On the
    /// near-black dark surface the brand blue falls under 4.5:1; its hover shade clears it.
    static let accentText = Color(uiColor: UIColor { traits in
        UIColor(rewardsHex: traits.userInterfaceStyle == .dark ? 0x5b8def : 0x2a68c0)
    })

    /// A medal follows the rank the server gave — never the row's position.
    static func medal(forRank rank: Int) -> Medal? {
        switch rank {
        case 1: return gold
        case 2: return silver
        case 3: return bronze
        default: return nil
        }
    }

    /// The web's chart ramp, light and dark — the initials colours for rows without a photo.
    /// Keyed on the student, not the rank, so a filter that moves somebody does not repaint them.
    static func tint(forStudent id: Int) -> Color {
        let ramp: [(Int, Int)] = [
            (0x2a68c0, 0x5b8def), (0x0ea5e9, 0x38bdf8), (0x059669, 0x34d399),
            (0xd97706, 0xfbbf24), (0xdb2777, 0xf472b6), (0x7c3aed, 0xa78bfa),
        ]
        let pair = ramp[((id % ramp.count) + ramp.count) % ramp.count]
        return Color(uiColor: UIColor { traits in
            UIColor(rewardsHex: traits.userInterfaceStyle == .dark ? pair.1 : pair.0)
        })
    }
}

extension Color {
    init(rewardsHex hex: Int) {
        self.init(uiColor: UIColor(rewardsHex: hex))
    }
}

extension UIColor {
    convenience init(rewardsHex hex: Int) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
