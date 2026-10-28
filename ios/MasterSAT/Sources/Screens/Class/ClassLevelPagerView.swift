import SwiftUI
import MasterSATKit

// One subject's level pager on the Class tab — the design's `slides()`, `paint()` and `dots()`.
// What each card says (state, covered, percent, "Unlocks after") is the kit's
// `ClassLevelCards`; this file only draws it.

/// A row of level cards that snaps one card at a time and opens on the student's own level,
/// with the cards on either side peeking in, faded and a touch smaller, and dots under it.
///
/// Tapping a card at the side brings it to the middle first, as the design does; tapping the
/// one in the middle opens its class page — if it is the current level or one already passed.
struct ClassLevelPagerView: View {
    let pager: ClassLevelPager
    /// The page's width, measured by the tab before any pager is built: a pager that measured
    /// itself would lay out once at a guess, and the first card placed at the guess's offset
    /// would sit off-centre on every other phone.
    let width: CGFloat
    /// The intro has run: bars full, numbers counted. True from the start under Reduce Motion.
    let filled: Bool
    let onOpen: (ClassLevelCard) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The card in the middle. Starts on the current level.
    @State private var position: Int?
    /// Placed on the current level once, on the first appearance — never again, so a refresh
    /// leaves the pager where the student swiped it.
    @State private var placed = false

    init(pager: ClassLevelPager, width: CGFloat, filled: Bool, onOpen: @escaping (ClassLevelCard) -> Void) {
        self.pager = pager
        self.width = width
        self.filled = filled
        self.onOpen = onOpen
        _position = State(initialValue: pager.openingIndex)
    }

    /// 346 on the design's 402-pt phone; on a narrower one, as wide as leaves the neighbours
    /// the same 18-pt peek.
    private var cardWidth: CGFloat { max(220, min(346, width - 56)) }
    private var sideInset: CGFloat { max(28, (width - cardWidth) / 2) }
    private var shown: Int { min(max(position ?? pager.openingIndex, 0), max(pager.cards.count - 1, 0)) }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 10) {
                        ForEach(pager.cards.indices, id: \.self) { index in
                            card(at: index)
                        }
                    }
                    .scrollTargetLayout()
                    // Every card as tall as the tallest: a locked card says less than an open one.
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
                }
                .contentMargins(.horizontal, sideInset, for: .scrollContent)
                .scrollTargetBehavior(.viewAligned)
                .scrollPosition(id: $position, anchor: .center)
                .scrollIndicators(.hidden)
                // The cards' shadows and the neighbours' edges are drawn past the row.
                .scrollClipDisabled()
                // The tab's room for the floating bar reaches this row too, as ~90 pt of empty
                // height under every pager. A row is not where the bar sits.
                .noBarClearanceInRow()
                .onAppear {
                    guard !placed else { return }
                    placed = true
                    proxy.scrollTo(pager.openingIndex, anchor: .center)
                }
            }
            dots
        }
        .padding(.bottom, 12)
    }

    private func card(at index: Int) -> some View {
        let card = pager.cards[index]
        let onShow = index == shown
        return Button {
            tap(index)
        } label: {
            ClassLevelCardView(card: card, width: cardWidth, filled: filled)
        }
        .buttonStyle(CardPress())
        // The neighbours fade and shrink a touch; under Reduce Motion they only fade. The same
        // modifiers either way — the setting picks the values, never the tree.
        .opacity(onShow ? 1 : 0.5)
        .scaleEffect(reduceMotion || onShow ? 1 : 0.96)
        .animation(ClassTabMotion.fade(0.25), value: onShow)
        .accessibilityHint(hint(for: card, onShow: onShow))
    }

    private func hint(for card: ClassLevelCard, onShow: Bool) -> String {
        if !onShow { return "Shows this level" }
        return card.opensClassPage ? "Opens the class" : ""
    }

    private func tap(_ index: Int) {
        guard pager.cards.indices.contains(index) else { return }
        if index != shown {
            go(to: index)
            return
        }
        let card = pager.cards[index]
        if card.opensClassPage { onOpen(card) }
    }

    private func go(to index: Int) {
        withAnimation(reduceMotion ? nil : ClassTabMotion.glide(0.45)) { position = index }
    }

    /// One dot per level: a long one in the subject's colour for the card on show.
    private var dots: some View {
        HStack(spacing: 0) {
            ForEach(pager.cards.indices, id: \.self) { index in
                let onShow = index == shown
                Button { go(to: index) } label: {
                    Capsule()
                        .fill(onShow ? ClassTabPalette.dot(pager.subject) : ClassTabPalette.dotIdle)
                        .frame(width: onShow ? 18 : 6, height: 6)
                        .padding(.horizontal, 3)
                        .frame(height: 16)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .animation(ClassTabMotion.fade(0.25), value: onShow)
                .accessibilityLabel(pager.cards[index].levelLabel)
                .accessibilityAddTraits(onShow ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(pager.subjectLabel) levels")
    }
}

/// A card's press: a slight give, not the 0.92 squash of a small control.
private struct CardPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .pressFeedback(isPressed: configuration.isPressed, scale: 0.98)
    }
}

// MARK: - One card

/// One level: the level's gradient, its subject's icon huge and faint in the corner, the
/// subject and the state pill, the level's name, and either how far the student has come or,
/// on a locked level, what it holds and what opens it.
struct ClassLevelCardView: View {
    let card: ClassLevelCard
    let width: CGFloat
    let filled: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isOpen: Bool { card.state != .locked }
    /// Only the current level counts up; a passed level is simply whole.
    private var counts: Bool { card.state == .current }
    /// A level whose lessons are not published yet has nothing to count.
    private var comingSoon: Bool { card.total == 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            topRow
            nameRow
            if isOpen {
                progressBar
            } else {
                lockLine
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(width: width, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(alignment: .bottomTrailing) { subjectMark }
        .background(card.palette.cardGradient)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        // `0 10px 26px c1 @ 35 %`.
        .shadow(color: Color(card.palette.start, opacity: 0.35), radius: 13, x: 0, y: 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    // MARK: Rows

    private var topRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: ClassTabSubject.symbol(card.subject))
                    .appFont(14, weight: .semibold)
                    .foregroundStyle(.white)
                Text(ClassTabSubject.label(card.subject))
                    .appFont(13, weight: .bold)
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            pill
            if isOpen {
                Image(systemName: "chevron.right")
                    .appFont(14, weight: .semibold)
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(.trailing, -2)
            }
        }
    }

    /// Completed ✓ on green, Current ◉ and Locked 🔒 on white glass.
    private var pill: some View {
        let completed = card.state == .completed
        return HStack(spacing: 4) {
            Image(systemName: pillSymbol)
                .appFont(10.5, weight: .bold)
            Text(card.state.pillText)
                .appFont(11.5, weight: .heavy)
        }
        .foregroundStyle(completed ? Color(RGB(hex: 0x12753A)) : .white)
        .padding(.leading, 7)
        .padding(.trailing, 9)
        .frame(minHeight: 22)
        .background(completed ? Color(RGB(hex: 0xDEF4E7)) : .white.opacity(0.22), in: Capsule())
        .fixedSize()
        .capDynamicType()
    }

    private var pillSymbol: String {
        switch card.state {
        case .completed: return "checkmark"
        case .current: return "record.circle"
        case .locked: return "lock.fill"
        }
    }

    private var nameRow: some View {
        AdaptiveStack(rowAlignment: .bottom, spacing: 10, columnSpacing: 4) {
            Text(card.levelLabel)
                .appDisplayFont(26)
                .tracking(-0.6)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            AdaptiveSpacer()
            if isOpen { covered }
        }
    }

    /// "28 / 36" over "lessons covered" — or, before the level has lessons, "Coming soon".
    @ViewBuilder private var covered: some View {
        if comingSoon {
            Text("Lessons coming soon")
                .appFont(12, weight: .semibold)
                .foregroundStyle(.white.opacity(0.8))
        } else {
            VStack(alignment: .trailing, spacing: 0) {
                CountingNumber(value: shownFraction) { fraction in
                    let done = counts ? Int((Double(card.covered) * fraction).rounded()) : card.covered
                    (Text(verbatim: "\(done)") + Text(verbatim: " / \(card.total)").foregroundStyle(.white.opacity(0.8)))
                        .appDisplayFont(20, monospacedDigits: true)
                        .tracking(-0.4)
                        .foregroundStyle(.white)
                }
                .animation(reduceMotion ? nil : ClassTabMotion.count.delay(0.26), value: filled)
                Text("lessons covered")
                    .appFont(12, weight: .semibold)
                    .foregroundStyle(.white.opacity(0.8))
            }
            .lineLimit(1)
            .fixedSize()
        }
    }

    /// The 8-pt bar and its percent. It fills as the numbers count.
    private var progressBar: some View {
        let fill = card.state == .completed ? 1 : Double(card.percent) / 100
        return HStack(spacing: 10) {
            Capsule()
                .fill(.white.opacity(0.25))
                .frame(height: 8)
                .overlay(alignment: .leading) {
                    GeometryReader { geo in
                        Capsule()
                            .fill(.white)
                            .frame(width: geo.size.width * (filled ? fill : 0))
                            .animation(reduceMotion ? nil : ClassTabMotion.glide(1.2).delay(0.35), value: filled)
                    }
                }
                .clipShape(Capsule())
            CountingNumber(value: shownFraction) { fraction in
                let percent = counts ? Int((Double(card.percent) * fraction).rounded()) : card.percent
                Text(verbatim: "\(percent)%")
                    .appFont(12.5, weight: .bold, monospacedDigits: true)
                    .foregroundStyle(.white.opacity(0.92))
            }
            .animation(reduceMotion ? nil : ClassTabMotion.count.delay(0.26), value: filled)
            .frame(minWidth: 36, alignment: .trailing)
            .lineLimit(1)
            .fixedSize()
            .capDynamicType()
        }
        .frame(minHeight: 16)
    }

    /// "24 lessons · Unlocks after Junior".
    private var lockLine: some View {
        HStack(spacing: 5) {
            Image(systemName: "lock.fill")
                .appFont(11, weight: .semibold)
                .foregroundStyle(.white.opacity(0.8))
            Text(lockText)
                .appFont(13, weight: .semibold)
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(minHeight: 16)
    }

    /// The subject's icon at 125 pt, white at 13 %, hanging off the bottom-right corner.
    private var subjectMark: some View {
        Image(systemName: ClassTabSubject.symbol(card.subject))
            .resizable()
            .scaledToFit()
            .frame(width: 125, height: 125)
            .foregroundStyle(.white.opacity(0.13))
            .offset(x: 4, y: 22)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: Words

    /// 0 → 1 as the count runs; already 1 under Reduce Motion.
    private var shownFraction: Double { filled ? 1 : 0 }

    private var lessonsText: String {
        card.total == 1 ? "1 lesson" : "\(card.total) lessons"
    }

    private var lockText: String {
        let what = comingSoon ? "Coming soon" : lessonsText
        guard let after = card.unlocksAfter else { return what }
        return "\(what) · Unlocks after \(after)"
    }

    private var accessibilityText: String {
        let head = "\(ClassTabSubject.label(card.subject)), \(card.levelLabel), \(card.state.pillText)"
        switch card.state {
        case .locked:
            return "\(head). \(lockText)"
        case .completed, .current:
            if comingSoon { return "\(head). Lessons coming soon" }
            return "\(head). \(card.covered) of \(lessonsText) covered, \(card.percent) percent"
        }
    }
}

/// How the tab names and draws a subject.
enum ClassTabSubject {
    static func label(_ subject: ClassSubject) -> String {
        subject == .math ? "Math" : "Reading & Writing"
    }

    /// The design's Material symbols, as the nearest SF Symbols: `square_foot` (a set square)
    /// → the pencil and ruler, `auto_stories` (an open book) → the open book.
    static func symbol(_ subject: ClassSubject) -> String {
        subject == .math ? "pencil.and.ruler.fill" : "book.fill"
    }
}
