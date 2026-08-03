import SwiftUI
import MasterSATKit

/// The site's page furniture, ported.
///
/// The web student area is written in two idioms and nothing else:
///
/// 1. **The board** (`/`, `/assessments`) — a very large flat headline over cards on a
///    tinted panel, no gradient anywhere. Used where the page is a *workspace*.
/// 2. **The hero** (`/vocabulary`, homework detail, classroom) — a gradient panel carrying
///    an eyebrow pill, the title, a sentence of orientation, and a row of live totals.
///    Used where the page is a *place* you have arrived at.
///
/// Both are reproduced here rather than re-invented, because the point of the app matching
/// the site is that a student recognises the page, not that the app has its own good taste.

// MARK: - The board idiom

/// The dzboard headline. 42px on the web; 32 here, which is the same *weight* on a phone.
struct PageTitle: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 32, weight: .heavy))
            // The web sets -.03em, which at this size is about a point of tracking. It is
            // most of why the headline reads as designed rather than as a default.
            .tracking(-0.9)
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A soft-filled rounded square holding one glyph — the site's `40×40 radius-12` tile,
/// in front of nearly every card title it has.
struct IconTile: View {
    let systemName: String
    var tone: Color = Theme.accent
    var size: CGFloat = 42

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.29, style: .continuous)
            .fill(tone.opacity(0.13))
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: systemName)
                    .font(.system(size: size * 0.46, weight: .semibold))
                    .foregroundStyle(tone)
            )
    }
}

/// A card's title row: tile, name, and one line saying what the card is for.
struct CardHeading: View {
    let icon: String
    let title: String
    var subtitle: String?
    var tone: Color = Theme.accent

    var body: some View {
        HStack(spacing: 13) {
            IconTile(systemName: icon, tone: tone)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 17, weight: .heavy))
                    .tracking(-0.2)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// A section label with a coloured dot and a count — the board columns' own header.
struct DotHeading: View {
    let title: String
    let count: Int?
    var tone: Color = Theme.accent

    var body: some View {
        HStack(spacing: 9) {
            Circle().fill(tone).frame(width: 10, height: 10)
            Text(title).font(.system(size: 15, weight: .heavy))
            if let count {
                Text(ScoreText.string(count))
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(Theme.textLabel)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.card))
            }
            Spacer(minLength: 0)
        }
    }
}

/// The site's empty slot: a dashed outline saying what would be here, and why it isn't.
///
/// A blank gap reads as a loading failure. A dashed box reads as "nothing yet", which is
/// usually the truth and never alarming.
struct DashedEmpty: View {
    let title: String
    var hint: String?

    var body: some View {
        VStack(spacing: 3) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            if let hint {
                Text(hint)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textLabel)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .strokeBorder(
                    Theme.separator.opacity(0.7),
                    style: StrokeStyle(lineWidth: 1.5, dash: [6, 5])
                )
        )
    }
}

/// One of the three boxes under "Target scores" — an overline, then the number, big.
struct ScoreBox: View {
    let label: String
    let value: Int?
    var emphasised = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .heavy))
                .tracking(1.3)
                .foregroundStyle(emphasised ? Theme.accent.opacity(0.85) : Theme.textLabel)
            Text(ScoreText.string(value))
                .font(.system(size: 30, weight: .heavy))
                .monospacedDigit()
                .tracking(-0.9)
                .foregroundStyle(emphasised ? Theme.accent : .primary)
                // Three boxes across a phone leaves ~80pt each, and a four-digit total in
                // monospaced digits does not fit. Shrinking beats wrapping "1450" onto two
                // lines, which is how it first rendered.
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(emphasised ? Theme.accentSoft : Theme.background)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .stroke(emphasised ? Theme.accent : Theme.separator.opacity(0.5), lineWidth: emphasised ? 1 : 0.5)
        )
    }
}

/// A small labelled fact inside a card — the "WHEN / TIME" pair under the next lesson.
struct InfoBox: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .heavy))
                .tracking(1.1)
                .foregroundStyle(Theme.textLabel)
            Text(value)
                .font(.system(size: 14, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Theme.background))
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }
}

// MARK: - The hero idiom

/// One live total on a hero — a label above a chip holding an icon and a number.
struct HeroTile: Identifiable, Equatable {
    let label: String
    let icon: String
    let value: String

    var id: String { label }

    init(_ label: String, icon: String, value: String) {
        self.label = label
        self.icon = icon
        self.value = value
    }

    init(_ label: String, icon: String, value: Int?) {
        self.init(label, icon: icon, value: ScoreText.string(value))
    }
}

/// The gradient page header the site puts on top of vocabulary, homework and classroom.
///
/// The two off-canvas circles are not decoration for its own sake: a flat blue rectangle at
/// this size looks like a rendering error, and the circles give the gradient somewhere to
/// go. They are clipped by the card, so they cost nothing but a shape each.
struct HeroHeader<Trailing: View>: View {
    let eyebrow: String
    let eyebrowIcon: String
    let title: String
    var blurb: String?
    var tiles: [HeroTile] = []
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
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

                    if let blurb {
                        Text(blurb)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.78))
                            .padding(.top, 10)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                trailing()
            }

            if !tiles.isEmpty {
                // Wraps rather than scrolls: four totals on one line is an iPad idea, and a
                // number a student has to swipe to find is a number they will not read.
                HeroTileFlow(tiles: tiles).padding(.top, 22)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Theme.accent, Theme.accentHover],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .background(Theme.accent)
        // Not decoration-only: an overlay is hit-testable, and these two cover most of the
        // hero. Anything interactive underneath would stop responding.
        .overlay(alignment: .bottomTrailing) {
            Circle().fill(.white.opacity(0.06))
                .frame(width: 210, height: 210)
                .offset(x: 40, y: 60)
                .allowsHitTesting(false)
        }
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.05))
                .frame(width: 150, height: 150)
                .offset(x: 20, y: -70)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

extension HeroHeader where Trailing == EmptyView {
    init(eyebrow: String, eyebrowIcon: String, title: String, blurb: String? = nil, tiles: [HeroTile] = []) {
        self.init(
            eyebrow: eyebrow,
            eyebrowIcon: eyebrowIcon,
            title: title,
            blurb: blurb,
            tiles: tiles,
            trailing: { EmptyView() }
        )
    }
}

/// Two columns of hero tiles. Fixed rather than measured: `HStack` + `Grid` both fight the
/// gradient's own sizing, and every hero on the site carries two or four of these.
private struct HeroTileFlow: View {
    let tiles: [HeroTile]

    var body: some View {
        let rows = stride(from: 0, to: tiles.count, by: 2).map { Array(tiles[$0..<min($0 + 2, tiles.count)]) }
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 28) {
                    ForEach(row) { tile in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(tile.label.uppercased())
                                .font(.system(size: 11, weight: .heavy))
                                .tracking(0.7)
                                .foregroundStyle(.white.opacity(0.72))
                            HStack(spacing: 6) {
                                Image(systemName: tile.icon)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.white.opacity(0.8))
                                Text(tile.value)
                                    .font(.system(size: 17, weight: .heavy))
                                    .monospacedDigit()
                                    .foregroundStyle(.white)
                            }
                            .padding(.horizontal, 11)
                            .padding(.vertical, 4)
                            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(.white.opacity(0.16)))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if row.count == 1 { Spacer(minLength: 0).frame(maxWidth: .infinity) }
                }
            }
        }
    }
}

// MARK: - Tabs

/// The site's pill tab bar: the selected tab is a filled capsule, the rest are plain, and
/// each can carry a count so a student sees there is homework without opening the tab.
struct PillTabs<Tab: Hashable>: View {
    struct Item: Identifiable {
        let tab: Tab
        let title: String
        let icon: String
        var count: Int?
        var highlighted = false

        var id: Tab { tab }
    }

    let items: [Item]
    @Binding var selection: Tab

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    let active = item.tab == selection
                    Button {
                        selection = item.tab
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: item.icon).font(.system(size: 12, weight: .bold))
                            Text(item.title).font(.system(size: 14, weight: .bold))
                            if let count = item.count {
                                Text(ScoreText.string(count))
                                    .font(.system(size: 11, weight: .heavy))
                                    .monospacedDigit()
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(
                                        Capsule().fill(
                                            active ? .white.opacity(0.24)
                                                : (item.highlighted ? Theme.accent.opacity(0.16) : Theme.surface2)
                                        )
                                    )
                                    .foregroundStyle(active ? .white : (item.highlighted ? Theme.accent : Theme.textSecondary))
                            }
                        }
                        .foregroundStyle(active ? .white : Theme.textSecondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(
                            Capsule().fill(active ? Theme.accent : Theme.card)
                        )
                        .overlay(
                            Capsule().stroke(active ? .clear : Theme.separator.opacity(0.5), lineWidth: 0.5)
                        )
                        // A button's label is only hit-testable where it draws, so the gaps
                        // between the glyph and the text would otherwise miss.
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            // A couple of points of vertical room so the selected pill's shadow is not
            // clipped by the scroller.
            .padding(.vertical, 2)
        }
        // No negative padding to "bleed" the row to the screen edge: it made the first pill
        // start off-screen. The row lines up with the cards under it instead.
        .scrollIndicators(.hidden)
    }
}

// MARK: - Wording

/// Deadlines, in the words the site uses.
///
/// A passed deadline reads "Catch up · Tue", never "Overdue" and never "Late". The student
/// already knows they are behind; the app's job is to make the next step obvious, not to
/// score the last one.
enum DueLabel {
    static func text(_ iso: String?) -> (text: String, late: Bool)? {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return nil }
        let late = date < Date()
        let days = abs(Calendar.current.dateComponents([.day], from: Date(), to: date).day ?? 0)
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate(days <= 6 ? "EEE" : "MMMd")
        let label = f.string(from: date)
        return (late ? "Catch up · \(label)" : "Due \(label)", late)
    }
}

/// "2 days ago", the way the site writes it.
enum RelativeTime {
    static func short(_ iso: String?) -> String {
        guard let iso, let date = JSONCoding.parseServerDate(iso) else { return "recently" }
        let seconds = Date().timeIntervalSince(date)
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        let days = Int(seconds / 86_400)
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days) days ago" }
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return f.string(from: date)
    }
}
