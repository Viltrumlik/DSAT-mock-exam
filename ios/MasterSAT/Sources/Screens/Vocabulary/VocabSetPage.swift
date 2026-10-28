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
    @Environment(CelebrationCenter.self) private var celebrations
    /// The header's XP when a game opened — what the round's gain is measured from.
    @State private var xpAtStudyStart: Int?

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if loadError != nil {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !title.isEmpty { NewLookPageHeading(title: title) }
                        VocabErrorNotice(
                            title: "This set isn't available",
                            message: "It may have been removed, or it belongs to another student. Pick another set from the hub."
                        ) { await load() }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                }
                .background(NewLook.page)
            } else {
                // The header, then the words.
                LoadingSkeleton(rows: 3, height: 110, style: .cards).skeletonPage().background(NewLook.page)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { if detail == nil { await load() } }
        .detachedRefresh { await load() }
        .fullScreenCover(item: $studying) { mode in
            if let detail {
                VocabStudyView(mode: mode, set: detail, assignmentId: assignmentId, onFinished: {
                    celebrations.celebrate(.vocabSession, xpBefore: xpAtStudyStart)
                }) {
                    studying = nil
                    // Progress moved; repaint from the server rather than guessing.
                    Task { await load() }
                }
                .coversCelebrations(celebrations)
                .noBarClearance()
            }
        }
        .onChange(of: studying) { _, mode in
            if mode != nil { xpAtStudyStart = celebrations.xpNow }
        }
        .sheet(isPresented: $isEditing) {
            if let detail {
                CustomSetBuilderView(editing: detail) { saved in
                    isEditing = false
                    if saved { Task { await load() } }
                }
                .noBarClearance()
            }
        }
    }

    // MARK: - Page

    private func content(_ detail: VocabSetDetail) -> some View {
        let tone = detail.section.map { VocabPalette.section(id: $0.id) } ?? VocabPalette.custom
        let glyph = detail.section.map { VocabPalette.glyph(sectionId: $0.id) } ?? VocabPalette.customGlyph
        let words = "\(ScoreText.string(detail.wordCount)) \(detail.wordCount == 1 ? "word" : "words")"
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                // The set's name is the page's heading; the section it belongs to is the line under it.
                NewLookPageHeading(title: detail.title, subtitle: "\(detail.section?.title ?? "My set") · \(words)")
                    .padding(.bottom, -8)
                hero(detail, tone: tone, glyph: glyph)
                launcher(detail)
                VocabWordList(words: detail.words, tone: tone, filter: $filter)
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .background(NewLook.page)
    }

    private func hero(_ detail: VocabSetDetail, tone: VocabPalette.Tone, glyph: String) -> some View {
        let mastery = detail.mastery
        let counts = VocabWordFilter.counts(detail.words)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 56, height: 56)
                    .overlay(
                        Image(systemName: glyph)
                            .appFont(25, weight: .semibold)
                            .capDynamicType()
                            .foregroundStyle(tone.solid)
                            .accessibilityHidden(true)
                    )
                FlowLayout(spacing: 6) {
                    Text(detail.section?.title ?? "My set")
                        .appFont(12.5, weight: .heavy)
                        .foregroundStyle(tone.ink)
                        .lineLimit(1)
                        .padding(.horizontal, 11)
                        .frame(minHeight: 26)
                        .background(Capsule().fill(tone.chip))
                    if mastery.isMastered {
                        NewLookChip(text: "Mastered", systemImage: "checkmark.circle", style: .green, small: false)
                    }
                    if detail.isCustom {
                        Button { isEditing = true } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "pencil").appFont(12, weight: .bold)
                                    .accessibilityHidden(true)
                                Text("Edit words").appFont(13, weight: .bold)
                            }
                            .foregroundStyle(NewLook.blueDeep)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 30)
                            .background(Capsule().fill(NewLook.blue50))
                            .contentShape(Capsule())
                        }
                        .buttonStyle(PressBounce())
                    }
                }
                Spacer(minLength: 0)
            }

            // "Games" leads: it is what the bar below measures and what homework is paid on.
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                NewLookFactTile(label: "Games mastered",
                                value: "\(ScoreText.string(mastery.masteredModes))/\(ScoreText.string(mastery.totalModes))",
                                valueColor: tone.ink, carve: "gamecontroller")
                NewLookFactTile(label: "Words", value: ScoreText.string(detail.wordCount), carve: "textformat")
                NewLookFactTile(label: "Mastered", value: ScoreText.string(counts[.mastered] ?? 0), carve: "checkmark.circle")
                NewLookFactTile(label: "New", value: ScoreText.string(counts[.new] ?? 0), carve: "circle")
            }

            // One segment per game in that game's own colour — the bar the set cards use, so a
            // colour means the same game on both.
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Mastery").newLookCaps()
                    Spacer()
                    Text("\(ScoreText.string(mastery.percent))%")
                        .appFont(13, weight: .heavy, monospacedDigits: true)
                        .foregroundStyle(tone.ink)
                }
                VocabMasteryBar(mastery: mastery, legend: true)
            }
            .padding(.top, 4)
        }
        .padding(.top, 4)
        .newLookEdgedCard(tone.solid, padding: 16, radius: 24)
    }

    // MARK: - The games

    private func launcher(_ detail: VocabSetDetail) -> some View {
        let empty = detail.words.isEmpty
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Study this set")
                    .appDisplayFont(19)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Play a game with every word right and it is mastered — a quarter of the bar each. All four, and the set is done.")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 2)
            if empty {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Nothing to study yet", systemImage: "exclamationmark.triangle.fill")
                        .appFont(14, weight: .heavy)
                        .foregroundStyle(NewLook.orangeInk)
                    Text("This set has no words, so the study modes stay locked."
                         + (detail.isCustom ? " Add a few words and they will unlock straight away." : ""))
                        .appFont(13, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NewLook.orange50))
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
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 48, height: 48)
                    .overlay(
                        Image(systemName: VocabPalette.gameGlyph(mode.kitMode))
                            .appFont(21, weight: .semibold)
                            .capDynamicType()
                            .foregroundStyle(tone.solid)
                            .accessibilityHidden(true)
                    )
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(VocabPalette.gameName(mode.kitMode))
                            .appDisplayFont(17)
                            .tracking(-0.2)
                            .foregroundStyle(NewLook.ink)
                        Spacer(minLength: 0)
                        score
                    }
                    Text(VocabPalette.gameBlurb(mode.kitMode))
                        .appFont(13)
                        .foregroundStyle(NewLook.muted)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if isEnabled {
                        HStack(spacing: 5) {
                            Text(mastered ? "Play again" : "Start").appFont(13, weight: .bold)
                            Image(systemName: "arrow.right").appFont(11, weight: .bold)
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(tone.ink)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 30)
                        .background(Capsule().fill(tone.track))
                        .padding(.top, 6)
                    }
                }
            }
            .padding(.top, 2)
            // The tone edge is the only thing that tells the four apart at a glance.
            .newLookEdgedCard(tone.solid, padding: 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.6)
    }

    private var score: some View {
        HStack(spacing: 3) {
            if mastered { Image(systemName: "checkmark.circle.fill").appFont(12, weight: .bold) }
            Text(mastered ? "1/1" : "0/1").appFont(12, weight: .heavy, monospacedDigits: true)
        }
        // Unearned reads in the game's own tint, not a grey badge.
        .foregroundStyle(mastered ? NewLook.greenInk : tone.ink)
        .padding(.horizontal, 8)
        .frame(minHeight: 22)
        .background(Capsule().fill(mastered ? NewLook.green50 : tone.track))
        .accessibilityElement(children: .ignore)
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
                    .frame(width: 42, height: 42)
                    .overlay(
                        Image(systemName: "textformat")
                            .appFont(18, weight: .semibold)
                            .capDynamicType()
                            .foregroundStyle(tone.solid)
                            .accessibilityHidden(true)
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text("Words")
                        .appDisplayFont(19)
                        .tracking(-0.3)
                        .foregroundStyle(NewLook.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(filter == .all
                         ? "\(ScoreText.string(shown.count)) in this set"
                         : "\(ScoreText.string(shown.count)) of \(ScoreText.string(words.count)) shown")
                        .appFont(13, weight: .medium)
                        .foregroundStyle(NewLook.muted)
                }
                Spacer(minLength: 0)
            }

            NewLookFilterChips(
                options: VocabWordFilter.allCases.map {
                    NewLookFilterChips<VocabWordFilter>.Option(value: $0, title: $0.label, systemImage: icon($0), count: counts[$0] ?? 0)
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
                VStack(spacing: 12) {
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    Text(word.word)
                        .appDisplayFont(19)
                        .tracking(-0.2)
                        .foregroundStyle(NewLook.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let part = word.partOfSpeech, !part.isEmpty {
                        Text(part).newLookCaps()
                    }
                }
                Spacer(minLength: 0)
                VocabWordStatusPill(status: word.status)
            }
            Text(word.definition)
                .appFont(15)
                .foregroundStyle(NewLook.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let example = word.example, !example.isEmpty {
                Text(verbatim: "“\(example)”")
                    .appFont(14).italic()
                    .foregroundStyle(NewLook.ink4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NewLook.sheet))
                    .padding(.top, 4)
            }
            if !word.synonyms.isEmpty {
                FlowLayout(spacing: 6) {
                    Text("Synonyms")
                        .newLookCaps()
                        .padding(.vertical, 5)
                    ForEach(Array(word.synonyms.enumerated()), id: \.offset) { _, synonym in
                        Text(synonym)
                            .appFont(12.5, weight: .semibold)
                            .foregroundStyle(NewLook.ink4)
                            .padding(.horizontal, 10)
                            .frame(minHeight: 24)
                            .background(Capsule().fill(NewLook.line))
                    }
                }
                .padding(.top, 4)
            }
        }
        .newLookCard(padding: 16)
    }
}
