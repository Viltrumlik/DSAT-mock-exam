import SwiftUI
import MasterSATKit

// The vocabulary feature's own furniture — the web's `features/vocabulary/components/`.
// Every type is prefixed `Vocab` so nothing here can collide with another feature's
// components of the same idea.

// MARK: - The "!"

/// The small round **!** that explains the thing beside it — the web's `ExplainButton`.
///
/// Pressed, not hovered: there is no hover on a phone, and the explanation is a paragraph a
/// student opens on purpose and reads. A popover rather than a sheet, so explaining one
/// control does not black out the page it sits on. It makes no request.
struct VocabExplainButton: View {
    let title: String
    /// Markdown — the web bolds the phrase that carries the rule.
    let text: String

    @State private var shown = false

    var body: some View {
        Button { shown.toggle() } label: {
            Text(verbatim: "!")
                .font(.system(size: 12, weight: .black))
                .foregroundStyle(shown ? Color.white : Theme.accent)
                .frame(width: 20, height: 20)
                .background(Circle().fill(shown ? Theme.accent : Theme.accent.opacity(0.10)))
                .overlay(Circle().stroke(shown ? Color.clear : Theme.accent.opacity(0.35), lineWidth: 1))
                // A 20pt dot is too small to hit; the target is the size a thumb needs.
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("What is \(title)?")
        .popover(isPresented: $shown) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Text(title)
                        .font(.system(size: 14, weight: .heavy))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button { shown = false } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 26, height: 26)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
                Text(LocalizedStringKey(text))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(width: 300, alignment: .leading)
            .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Bars and rings

/// A set's progress bar: one segment per game, filled when that game has been played clean.
///
/// Four separated segments rather than one sliding fill, because the rule is discrete — a
/// quarter appears the moment a game is mastered and never moves in between. Each segment
/// wears its own game's colour, so the bar says WHICH game is still owed; an unplayed segment
/// is a tint of that hue, so a set at 0% still has colour in it.
struct VocabMasteryBar: View {
    let mastery: VocabSetMastery
    var legend = false
    var height: CGFloat = 10

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(VocabStudyMode.allCases, id: \.self) { mode in
                    let tone = VocabPalette.game(mode)
                    Capsule()
                        .fill(mastery.isMastered(mode) ? tone.solid : tone.track)
                        .frame(height: height)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(ScoreText.string(mastery.masteredModes)) of \(ScoreText.string(mastery.totalModes)) games mastered")

            if legend {
                FlowLayout(spacing: 12) {
                    ForEach(VocabStudyMode.allCases, id: \.self) { mode in
                        let tone = VocabPalette.game(mode)
                        let done = mastery.isMastered(mode)
                        HStack(spacing: 6) {
                            Circle().fill(done ? tone.solid : tone.track).frame(width: 8, height: 8)
                            Text(VocabPalette.gameName(mode))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(done ? tone.ink : Theme.textSecondary)
                        }
                    }
                }
                .accessibilityHidden(true)
            }
        }
    }
}

/// A section's bar, one scale up and therefore continuous: how many of its sets are done.
struct VocabSectionMasteryBar: View {
    let mastery: VocabSectionMastery
    let tone: VocabPalette.Tone

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(tone.track)
                    Capsule()
                        .fill(tone.solid)
                        .frame(width: geometry.size.width * CGFloat(min(max(mastery.percent, 0), 100)) / 100)
                }
            }
            .frame(height: 10)
            .accessibilityHidden(true)

            let done = Text(verbatim: ScoreText.string(mastery.masteredSets))
                .fontWeight(.bold)
                .foregroundStyle(Color.primary)
            Text("\(done) of \(ScoreText.string(mastery.totalSets)) \(mastery.totalSets == 1 ? "set" : "sets") mastered")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

/// A ring with its percentage in the middle — the web's `ProgressRing`, whose unfilled arc is
/// a tint of its own hue rather than a grey doughnut.
struct VocabProgressRing: View {
    let percent: Int
    let solid: Color
    let track: Color
    var size: CGFloat = 54
    var lineWidth: CGFloat = 5

    var body: some View {
        let clamped = CGFloat(min(max(percent, 0), 100)) / 100
        ZStack {
            Circle().stroke(track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(solid, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(ScoreText.string(min(max(percent, 0), 100)))%")
                .font(.system(size: size >= 60 ? 15 : 13, weight: .black).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, lineWidth + 2)
        }
        .frame(width: size, height: size)
    }
}

/// The thin gradient along a card's top edge: the one mark of colour that still reads when
/// the card is scrolled to its title.
struct VocabTopEdge: View {
    let colour: Color
    var height: CGFloat = 3

    var body: some View {
        LinearGradient(
            colors: [colour, colour.opacity(0.4), colour.opacity(0)],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: height)
        .allowsHitTesting(false)
    }
}

// MARK: - Chips and pills

/// A count in a card's own colour — "8 sets", "200 words", "2/4 games".
struct VocabMetaChip: View {
    let icon: String
    let text: String
    let ink: Color
    let fill: Color

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10, weight: .bold))
            Text(text).font(.system(size: 12, weight: .bold)).monospacedDigit()
        }
        .foregroundStyle(ink)
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Capsule().fill(fill))
    }
}

/// A word's standing: a hollow ring for "not proven yet", a tick for "right in all four
/// games". "New" stays neutral on purpose — a word not yet mastered is not a failure.
struct VocabWordStatusPill: View {
    let status: VocabWordStatus

    var body: some View {
        switch status {
        case .mastered: Chip(text: "Mastered", icon: "checkmark.circle.fill", tone: .success)
        case .new: Chip(text: "New", icon: "circle", tone: .neutral)
        }
    }
}

// MARK: - Cards

/// One study set, wherever it appears — a section's list, My sets, a homework group.
///
/// A mastered set says so three ways, so it reads at a glance: a success tile, the "Mastered"
/// pill and a success ring on the card. Short of that the card shows how many games are left,
/// which is the number a student can act on. It is the label of a link; the button inside is
/// what the link looks like, not a second target.
struct VocabSetCard: View {
    let title: String
    let wordCount: Int
    /// Any one game finished — only ever "Keep going", never the badge.
    let completed: Bool
    let mastery: VocabSetMastery
    var subtitle: String?
    var actionLabel = "Practice"
    /// Room on the right for a control laid over the card (My sets' delete).
    var reservesTrailingControl = false

    private var mastered: Bool { mastery.isMastered }
    private var chipInk: Color { mastered ? VocabPalette.mastered.ink : Theme.accent }
    private var chipFill: Color { mastered ? VocabPalette.mastered.solid.opacity(0.12) : Theme.accent.opacity(0.10) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(mastered ? Theme.successSoft : Theme.accentSoft)
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: mastered ? "checkmark.circle.fill" : "book")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(mastered ? Theme.success : Theme.accent)
                    )

                VStack(alignment: .leading, spacing: 7) {
                    Text(title)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    FlowLayout(spacing: 6) {
                        VocabMetaChip(
                            icon: "textformat",
                            text: "\(ScoreText.string(wordCount)) \(wordCount == 1 ? "word" : "words")",
                            ink: chipInk,
                            fill: chipFill
                        )
                        VocabMetaChip(
                            icon: "gamecontroller.fill",
                            text: "\(ScoreText.string(mastery.masteredModes))/\(ScoreText.string(mastery.totalModes)) games",
                            ink: chipInk,
                            fill: chipFill
                        )
                        if let subtitle, !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Capsule().fill(Theme.surface2))
                        }
                    }
                }
                Spacer(minLength: 0)
                if mastered {
                    Chip(text: "Mastered", icon: "checkmark.circle.fill", tone: .success)
                }
                if reservesTrailingControl {
                    Color.clear.frame(width: 30, height: 30)
                }
            }

            VocabMasteryBar(mastery: mastery)

            HStack(spacing: 7) {
                Image(systemName: "play.fill").font(.system(size: 11, weight: .bold))
                Text(mastered ? "Play again" : (completed ? "Keep going" : actionLabel))
                    .font(.system(size: 14, weight: .bold))
            }
            .foregroundStyle(mastered ? Theme.accent : Color.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(mastered ? Theme.surface2 : Theme.accent)
            )
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(mastered ? Theme.success.opacity(0.4) : Theme.separator.opacity(0.5),
                        lineWidth: mastered ? 1 : 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
    }
}

/// One published bank section on the hub.
///
/// The card stays white; the section's colour lives in its small marks only — the top edge,
/// the glyph, the chips, the ring, the bar and "Open section" — which is enough to tell four
/// cards apart at a glance. The ring and the bar answer different questions: the ring counts
/// WORDS mastered, the bar counts SETS mastered.
struct VocabSectionCard: View {
    let section: VocabSection

    private var tone: VocabPalette.Tone { VocabPalette.section(id: section.id) }
    private var done: Bool { section.mastery.percent >= 100 && section.setCount > 0 }
    private var shown: VocabPalette.Tone { done ? VocabPalette.mastered : tone }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(shown.tile)
                    .frame(width: 48, height: 48)
                    .overlay(
                        Image(systemName: VocabPalette.glyph(sectionId: section.id))
                            .font(.system(size: 21, weight: .semibold))
                            .foregroundStyle(shown.solid)
                    )

                VStack(alignment: .leading, spacing: 5) {
                    Text(section.title)
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    if let description = section.description, !description.isEmpty {
                        Text(description)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                    }
                    FlowLayout(spacing: 6) {
                        VocabMetaChip(
                            icon: "square.stack.3d.up.fill",
                            text: "\(ScoreText.string(section.setCount)) \(section.setCount == 1 ? "set" : "sets")",
                            ink: tone.ink,
                            fill: tone.chip
                        )
                        VocabMetaChip(
                            icon: "textformat",
                            text: "\(ScoreText.string(section.wordCount)) \(section.wordCount == 1 ? "word" : "words")",
                            ink: tone.ink,
                            fill: tone.chip
                        )
                    }
                    .padding(.top, 4)
                }
                Spacer(minLength: 0)

                VStack(spacing: 4) {
                    VocabProgressRing(percent: section.progress.percentMastered, solid: shown.solid, track: shown.track)
                    Text("WORDS")
                        .font(.system(size: 9.5, weight: .heavy))
                        .tracking(0.7)
                        .foregroundStyle(Theme.textSecondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(ScoreText.string(section.progress.mastered)) of \(ScoreText.string(section.progress.total)) words mastered")
            }

            VocabSectionMasteryBar(mastery: section.mastery, tone: shown)

            HStack(spacing: 4) {
                Text("Open section").font(.system(size: 13, weight: .bold))
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(tone.ink)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(alignment: .top) { VocabTopEdge(colour: tone.solid) }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(done ? Theme.success.opacity(0.4) : Theme.separator.opacity(0.5), lineWidth: done ? 1 : 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
    }
}

/// The four games, on the hub — the key to the coloured bar on every set card.
///
/// The rule itself (one clean run masters a game, four master the set) is non-obvious enough
/// to need a sentence, so it sits behind the "!" where a student can ask for it rather than
/// being told it on every visit.
struct VocabGameGuide: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(systemName: "gamecontroller.fill", tone: Theme.accent, size: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Four ways to play every set")
                        .font(.system(size: 17, weight: .heavy))
                        .tracking(-0.2)
                    Text("The coloured bar on every set card is these four — a quarter each.")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                VocabExplainButton(
                    title: "How a set is mastered",
                    text: "Play one game with **every word right** and that game is mastered — a quarter of the set’s bar fills in its colour. Master all four and the set is done. There is no part credit: a run with one mistake leaves the quarter empty, so you can simply play it again."
                )
            }

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(VocabStudyMode.allCases, id: \.self) { mode in
                    let tone = VocabPalette.game(mode)
                    VStack(alignment: .leading, spacing: 0) {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(tone.tile)
                            .frame(width: 44, height: 44)
                            .overlay(
                                Image(systemName: VocabPalette.gameGlyph(mode))
                                    .font(.system(size: 19, weight: .semibold))
                                    .foregroundStyle(tone.solid)
                            )
                        Text(VocabPalette.gameName(mode))
                            .font(.system(size: 14.5, weight: .heavy))
                            .foregroundStyle(tone.ink)
                            .padding(.top, 12)
                        Text(VocabPalette.gameBlurb(mode))
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 4)
                        Spacer(minLength: 12)
                        // This game's quarter, at the size it appears on a set card.
                        Capsule().fill(tone.solid).frame(height: 6)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(Theme.card)
                    .overlay(alignment: .top) { VocabTopEdge(colour: tone.solid, height: 4) }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .stroke(Theme.separator.opacity(0.6), lineWidth: 0.5)
                    )
                }
            }
        }
        .cardStyle(padding: 18)
    }
}

// MARK: - States

/// A failed load, named as one — never an empty state. The web's `VocabErrorState`.
struct VocabErrorNotice: View {
    let title: String
    var message = "Something went wrong on our end. Check your connection and try again."
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Theme.warning)
            Text(title)
                .font(.system(size: 16, weight: .heavy))
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
    }
}

/// An empty answer with something to do about it: a dashed slot, and one way forward.
struct VocabEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (@MainActor () -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 48, height: 48)
                .background(Circle().fill(Theme.accentSoft))
            Text(title)
                .font(.system(size: 15, weight: .heavy))
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                Button(action: action) {
                    Label(actionTitle, systemImage: "plus")
                }
                .buttonStyle(SecondaryButtonStyle())
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 18)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .strokeBorder(Theme.separator.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
        )
    }
}

/// A homework's deadline in the site's words: "Due Fri", amber "Catch up · Tue", or
/// "No deadline". Never red — nothing here has failed.
struct VocabDueChip: View {
    let dueAt: String?

    var body: some View {
        if let due = DueLabel.text(dueAt) {
            Chip(text: due.text, icon: "calendar.badge.clock", tone: due.late ? .warning : .neutral)
        } else {
            Chip(text: "No deadline", icon: "calendar.badge.clock", tone: .neutral)
        }
    }
}
