import SwiftUI
import MasterSATKit

/// One set — the site's `/vocabulary/sets/{id}`: what is in it, which games are mastered, and
/// the four ways to study it.
///
/// The page is a crossroads: the same set is reached from the question bank, from My sets and
/// from one or more homework cards, and it cannot work out which on its own. So whoever opens
/// it says so — `assignmentId` is the homework it was opened from (nil for self-study) — and
/// every game launched from here carries it, so each run is credited to that homework and not
/// to the server's guess.
struct VocabSetView: View {
    let setId: Int
    let title: String
    var assignmentId: Int?

    @Environment(Session.self) private var session
    @State private var detail: VocabSetDetail?
    @State private var loadError: String?
    @State private var studying: StudyMode?
    @State private var filter: VocabWordFilter = .all
    @State private var isEditing = false

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if loadError != nil {
                ScrollView {
                    VocabErrorNotice(
                        title: "This set isn't available",
                        message: "It may have been removed, or it belongs to another student. Pick another set from the hub."
                    ) { await load() }
                    .padding(16)
                }
                .background(Theme.background)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.background)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { if detail == nil { await load() } }
        .refreshable { await load() }
        .fullScreenCover(item: $studying) { mode in
            if let detail {
                VocabStudyView(mode: mode, set: detail, assignmentId: assignmentId) {
                    studying = nil
                    // Progress moved; repaint from the server rather than guessing.
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $isEditing) {
            if let detail {
                CustomSetBuilderView(editing: detail) { saved in
                    isEditing = false
                    if saved { Task { await load() } }
                }
            }
        }
    }

    // MARK: - Page

    private func content(_ detail: VocabSetDetail) -> some View {
        let tone = detail.section.map { VocabPalette.section(id: $0.id) } ?? VocabPalette.custom
        let glyph = detail.section.map { VocabPalette.glyph(sectionId: $0.id) } ?? VocabPalette.customGlyph
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                hero(detail, tone: tone, glyph: glyph)
                launcher(detail)
                VocabWordList(words: detail.words, tone: tone, filter: $filter)
            }
            .padding(16)
        }
        .background(Theme.background)
    }

    private func hero(_ detail: VocabSetDetail, tone: VocabPalette.Tone, glyph: String) -> some View {
        let mastery = detail.mastery
        let counts = VocabWordFilter.counts(detail.words)
        return VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 56, height: 56)
                    .overlay(
                        Image(systemName: glyph)
                            .font(.system(size: 25, weight: .semibold))
                            .foregroundStyle(tone.solid)
                    )
                VStack(alignment: .leading, spacing: 10) {
                    FlowLayout(spacing: 6) {
                        Text(detail.section?.title ?? "My set")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundStyle(tone.ink)
                            .lineLimit(1)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(tone.chip))
                        if mastery.isMastered {
                            Chip(text: "Mastered", icon: "checkmark.circle.fill", tone: .success)
                        }
                    }
                    Text(detail.title)
                        .font(.system(size: 28, weight: .heavy))
                        .tracking(-0.7)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            if detail.isCustom {
                Button { isEditing = true } label: {
                    Label("Edit words", systemImage: "pencil")
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Theme.surface2))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }

            // "Games" leads: it is what the bar below measures and what homework is paid on.
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                factTile("Games mastered", icon: "gamecontroller.fill",
                         value: "\(ScoreText.string(mastery.masteredModes))/\(ScoreText.string(mastery.totalModes))",
                         ink: tone.ink)
                factTile("Words", icon: "textformat", value: ScoreText.string(detail.wordCount))
                factTile("Mastered", icon: "checkmark.circle", value: ScoreText.string(counts[.mastered] ?? 0))
                factTile("New", icon: "circle", value: ScoreText.string(counts[.new] ?? 0))
            }

            // One segment per game in that game's own colour — the bar the set cards use, so a
            // colour means the same game on both.
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("MASTERY")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1.0)
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Text("\(ScoreText.string(mastery.percent))%")
                        .font(.system(size: 13, weight: .heavy).monospacedDigit())
                        .foregroundStyle(tone.ink)
                }
                VocabMasteryBar(mastery: mastery, legend: true)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(alignment: .top) { VocabTopEdge(colour: tone.solid, height: 4) }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }

    private func factTile(_ label: String, icon: String, value: String, ink: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 10.5, weight: .bold))
                .tracking(0.9)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.system(size: 24, weight: .heavy).monospacedDigit())
                .tracking(-0.5)
                .foregroundStyle(ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.background)
        )
        .overlay(alignment: .bottomTrailing) {
            // The glyph is carved into the block rather than printed on it.
            Image(systemName: icon)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Color.primary.opacity(0.05))
                .offset(x: 6, y: 8)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }

    // MARK: - The games

    private func launcher(_ detail: VocabSetDetail) -> some View {
        let empty = detail.words.isEmpty
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Study this set")
                    .font(.system(size: 20, weight: .heavy))
                    .tracking(-0.3)
                Text("Play a game with every word right and it is mastered — a quarter of the bar each. All four, and the set is done.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if empty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Nothing to study yet", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(Theme.warning)
                    Text("This set has no words, so the study modes stay locked."
                         + (detail.isCustom ? " Add a few words and they will unlock straight away." : ""))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.warningSoft))
            }
            ForEach(StudyMode.allCases) { mode in
                VocabModeCard(
                    mode: mode,
                    mastered: detail.mastery.isMastered(mode.kitMode),
                    isEnabled: !empty
                ) {
                    studying = mode
                }
            }
        }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            detail = try await session.student.vocabularySet(id: setId)
        } catch let error as APIError {
            loadError = error.errorDescription ?? "error"
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// A game launcher on a set's page, with its per-game score.
///
/// The score is always **0/1 or 1/1**, never a percentage: a game is mastered by one clean run
/// and nothing in between counts, so any other denominator would promise partial credit that
/// does not exist. Reading the four cards top to bottom gives the number the bar above shows.
struct VocabModeCard: View {
    let mode: StudyMode
    let mastered: Bool
    let isEnabled: Bool
    let onTap: @MainActor () -> Void

    private var tone: VocabPalette.Tone { VocabPalette.game(mode.kitMode) }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 48, height: 48)
                    .overlay(
                        Image(systemName: VocabPalette.gameGlyph(mode.kitMode))
                            .font(.system(size: 21, weight: .semibold))
                            .foregroundStyle(tone.solid)
                    )
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(VocabPalette.gameName(mode.kitMode))
                            .font(.system(size: 17, weight: .heavy))
                            .foregroundStyle(.primary)
                        Spacer(minLength: 0)
                        score
                    }
                    Text(VocabPalette.gameBlurb(mode.kitMode))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if isEnabled {
                        HStack(spacing: 5) {
                            Text(mastered ? "Play again" : "Start").font(.system(size: 13, weight: .bold))
                            Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(tone.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(tone.track))
                        .padding(.top, 6)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            // The accent edge is the only thing that tells the four apart at a glance.
            .overlay(alignment: .top) {
                LinearGradient(
                    colors: [tone.solid.opacity(0.7), tone.solid.opacity(0.25), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(height: 4)
                .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.6)
    }

    private var score: some View {
        HStack(spacing: 4) {
            if mastered { Image(systemName: "checkmark.circle.fill").font(.system(size: 11, weight: .bold)) }
            Text(mastered ? "1/1" : "0/1").font(.system(size: 12, weight: .heavy).monospacedDigit())
        }
        // Unearned reads in the game's own tint, not a grey badge.
        .foregroundStyle(mastered ? VocabPalette.mastered.ink : tone.ink)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(mastered ? Theme.successSoft : tone.track))
        .accessibilityLabel(mastered ? "Mastered — one clean run" : "Not mastered yet")
    }
}

/// The set's words, with the All / New / Mastered filter.
struct VocabWordList: View {
    let words: [VocabWord]
    let tone: VocabPalette.Tone
    @Binding var filter: VocabWordFilter

    private var counts: [VocabWordFilter: Int] { VocabWordFilter.counts(words) }
    private var shown: [VocabWord] { filter.apply(words) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 44, height: 44)
                    .overlay(Image(systemName: "textformat").font(.system(size: 18, weight: .semibold)).foregroundStyle(tone.solid))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Words").font(.system(size: 20, weight: .heavy)).tracking(-0.3)
                    Text(filter == .all
                         ? "\(ScoreText.string(shown.count)) in this set"
                         : "\(ScoreText.string(shown.count)) of \(ScoreText.string(words.count)) shown")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            PillTabs(
                items: VocabWordFilter.allCases.map {
                    PillTabs<VocabWordFilter>.Item(tab: $0, title: $0.label, icon: icon($0), count: counts[$0] ?? 0)
                },
                selection: $filter
            )

            if shown.isEmpty {
                DashedEmpty(
                    title: words.isEmpty ? "No words in this set yet" : "Nothing in \(filter == .all ? "this set" : filter.label)",
                    hint: words.isEmpty
                        ? "Words appear here once this set has been filled in."
                        : "A word is mastered once every game has had it right."
                )
            } else {
                VStack(spacing: 10) {
                    ForEach(shown) { VocabWordRow(word: $0) }
                }
            }
        }
    }

    private func icon(_ filter: VocabWordFilter) -> String {
        switch filter {
        case .all: return "square.stack"
        case .new: return "circle"
        case .mastered: return "checkmark.circle"
        }
    }
}

struct VocabWordRow: View {
    let word: VocabWord

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    Text(word.word)
                        .font(.system(size: 18, weight: .heavy))
                        .tracking(-0.2)
                    if let part = word.partOfSpeech, !part.isEmpty {
                        Overline(part)
                    }
                }
                Text(word.definition)
                    .font(.system(size: 14.5))
                    .fixedSize(horizontal: false, vertical: true)
                if let example = word.example, !example.isEmpty {
                    Text(verbatim: "“\(example)”")
                        .font(.system(size: 13.5).italic())
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.surface2))
                        .padding(.top, 4)
                }
                if !word.synonyms.isEmpty {
                    FlowLayout(spacing: 6) {
                        Overline("Synonyms")
                            .padding(.vertical, 4)
                        ForEach(Array(word.synonyms.enumerated()), id: \.offset) { _, synonym in
                            Text(synonym)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(Theme.surface2))
                        }
                    }
                    .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
            VocabWordStatusPill(status: word.status)
        }
        .cardStyle(padding: 16)
    }
}
