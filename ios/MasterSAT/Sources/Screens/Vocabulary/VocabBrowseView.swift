import SwiftUI
import MasterSATKit

/// One section of the published bank and the sets inside it — the site's
/// `/vocabulary/sections/{id}`.
///
/// It wears the colour and glyph its hub card wore, so the section is the same place on both
/// pages. The ring counts SETS mastered, matching the bars on the cards below; the three facts
/// under the title each carry a second fact the headline cannot give.
///
/// The bank is browsable whether or not a teacher has assigned anything — a student who wants
/// to get ahead should not have to wait to be given permission.
struct VocabSectionView: View {
    let sectionId: Int
    let title: String

    @Environment(Session.self) private var session
    @State private var detail: VocabSectionDetail?
    @State private var failed = false

    private var tone: VocabPalette.Tone { VocabPalette.section(id: sectionId) }

    /// The page's name: the section's own once it has loaded, the one the link carried until then.
    private var heading: String { detail?.title ?? title }

    var body: some View {
        Group {
            if let detail {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NewLookPageHeading(title: detail.title, subtitle: detail.description)
                            .padding(.bottom, 4)
                        header(detail)
                        setList(detail)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                }
                .background(NewLook.page)
            } else if failed {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !heading.isEmpty { NewLookPageHeading(title: heading) }
                        VocabErrorNotice(
                            title: "This section isn't available",
                            message: "It may have been unpublished. Head back to the vocabulary hub and pick another one."
                        ) { await load() }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                }
                .background(NewLook.page)
            } else {
                // The header, then the set cards.
                LoadingSkeleton(rows: 3, height: 110, style: .cards).skeletonPage().background(NewLook.page)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // The "!" is the trailing pill of the bar: the title moved out of the header card into
        // the page's own heading, and the explanation went with the bar.
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                VocabExplainButton(
                    title: "What the ring and the bars mean",
                    text: "The ring counts the **sets** you have finished in this section. The four-colour bar on each card below is that set’s four games — one colour each — filled once you play that game with every word right.",
                    inToolbar: true
                )
            }
        }
        .task { if detail == nil { await load() } }
        .detachedRefresh { await load() }
    }

    private func header(_ detail: VocabSectionDetail) -> some View {
        let percent = detail.mastery.percent
        let complete = percent >= 100
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 14) {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(tone.tile)
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: VocabPalette.glyph(sectionId: sectionId))
                            .appFont(18, weight: .semibold)
                            .capDynamicType()
                            .foregroundStyle(tone.solid)
                            .accessibilityHidden(true)
                    )
                VStack(alignment: .leading, spacing: 6) {
                    FlowLayout(spacing: 6) {
                        NewLookChip(text: "Question bank", style: .blue, small: false)
                        if detail.everySetMastered {
                            NewLookChip(text: "Every set mastered", systemImage: "checkmark.circle", style: .green, small: false)
                        }
                    }
                    Text("The ring counts the sets you have finished here.")
                        .appFont(14, weight: .medium)
                        .foregroundStyle(NewLook.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                VocabProgressRing(
                    percent: percent,
                    solid: complete ? VocabPalette.mastered.solid : tone.solid,
                    track: complete ? VocabPalette.mastered.track : tone.track,
                    size: 64,
                    lineWidth: 6
                )
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(ScoreText.string(detail.mastery.masteredSets)) of \(ScoreText.string(detail.sets.count)) sets mastered")
            }
            .padding(.bottom, 4)

            NewLookFactTile(
                label: "Sets",
                value: ScoreText.string(detail.sets.count),
                detail: detail.startedSets > 0
                    ? "\(ScoreText.string(detail.startedSets)) already started"
                    : "none started yet",
                carve: "square.stack.3d.up",
                layout: .row
            )
            NewLookFactTile(
                label: "Words",
                value: ScoreText.string(detail.wordCount),
                detail: "\(ScoreText.string(detail.progress.mastered)) of them mastered",
                carve: "textformat",
                layout: .row
            )
            NewLookFactTile(
                label: "Sets mastered",
                value: ScoreText.string(detail.mastery.masteredSets),
                valueColor: tone.ink,
                detail: "\(ScoreText.string(percent))% of this section",
                carve: "trophy",
                layout: .row
            )
        }
        .padding(.top, 4)
        .newLookEdgedCard(tone.solid, padding: 16, radius: 24)
    }

    @ViewBuilder
    private func setList(_ detail: VocabSectionDetail) -> some View {
        if detail.sets.isEmpty {
            VocabEmptyState(
                title: "This section has no sets yet",
                message: "Sets show up as soon as the words are published. Try another section in the meantime."
            )
        } else {
            VStack(spacing: 14) {
                ForEach(detail.sets) { set in
                    // A value, not a destination: whichever stack the section was pushed on — the
                    // Words tab, or another tab through a link — resolves `AppLink`s.
                    NavigationLink(value: AppLink.vocabularySet(id: set.id)) {
                        VocabSetCard(
                            title: set.title,
                            wordCount: set.wordCount,
                            completed: set.completed,
                            mastery: set.mastery
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @MainActor
    private func load() async {
        failed = false
        do {
            detail = try await session.student.vocabularySection(id: sectionId)
        } catch {
            failed = true
        }
    }
}

/// Building a set — or, given one, editing it: search the bank, pick words, name it.
///
/// Editing replaces the set's words wholesale (`word_ids` IS the membership and the order),
/// which is the endpoint's contract, so the list shown here is exactly what is saved.
struct CustomSetBuilderView: View {
    var editing: VocabSetDetail?
    /// `true` when something was saved and the caller should reload.
    let onDone: @MainActor (Bool) -> Void

    @Environment(Session.self) private var session
    @State private var title = ""
    @State private var query = ""
    @State private var results: [VocabWord] = []
    @State private var picked: [VocabWord] = []
    @State private var isSearching = false
    @State private var searchFailed = false
    @State private var isSaving = false
    @State private var errorText: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var seeded = false

    init(editing: VocabSetDetail? = nil, onDone: @escaping @MainActor (Bool) -> Void) {
        self.editing = editing
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Set name") {
                    TextField("Name", text: $title, prompt: Text(verbatim: "Words I keep missing"))
                }

                if !picked.isEmpty {
                    Section("\(picked.count) chosen") {
                        ForEach(picked) { word in
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(word.word).font(.subheadline.weight(.medium))
                                    Text(word.definition).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                Button {
                                    picked.removeAll { $0.id == word.id }
                                } label: {
                                    Image(systemName: "minus.circle.fill").foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Remove \(word.word)")
                            }
                        }
                    }
                }

                Section {
                    if isSearching {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if searchFailed {
                        // A failed search is not "nothing matches".
                        Text("Search failed. Check your connection and try again.")
                            .font(.caption)
                            .foregroundStyle(Theme.warning)
                    } else if results.isEmpty {
                        Text(query.isEmpty ? "Search the bank for words to add." : "No matches for “\(query)”")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(results) { word in
                            Button {
                                guard !picked.contains(where: { $0.id == word.id }) else { return }
                                picked.append(word)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 1) {
                                        HStack(spacing: 6) {
                                            Text(word.word).font(.subheadline.weight(.medium))
                                            // The bank stores the same word once per
                                            // section, so a search returns three identical
                                            // rows unless the section is shown.
                                            if let section = word.sectionTitle, !section.isEmpty {
                                                Text(section).font(.caption2).foregroundStyle(.secondary)
                                            }
                                        }
                                        Text(word.definition).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                    Spacer()
                                    Image(systemName: picked.contains { $0.id == word.id }
                                          ? "checkmark.circle.fill" : "plus.circle")
                                        .foregroundStyle(Theme.accent)
                                        .accessibilityHidden(true)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityValue(picked.contains { $0.id == word.id } ? "Added" : "")
                        }
                    }
                } header: {
                    Text("Add words")
                } footer: {
                    if let errorText { Text(errorText).foregroundStyle(Theme.danger) }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $query, prompt: Text(verbatim: "Search words or definitions…"))
            .onChange(of: query) { _, _ in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    if Task.isCancelled { return }
                    await search()
                }
            }
            .navigationTitle(editing == nil ? "New set" : "Edit set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDone(false) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSaving { ProgressView() } else { Text(editing == nil ? "Create" : "Save").bold() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || picked.isEmpty || isSaving)
                    .accessibilityLabel(isSaving ? "Saving" : (editing == nil ? "Create" : "Save"))
                }
            }
            .onAppear(perform: seed)
        }
    }

    /// Editing starts from the set as it is — its name, and its words in their order.
    private func seed() {
        guard !seeded, let editing else { return }
        seeded = true
        title = editing.title
        picked = editing.words
    }

    @MainActor
    private func search() async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            searchFailed = false
            return
        }
        isSearching = true
        searchFailed = false
        defer { isSearching = false }
        do {
            results = try await session.student.searchVocabularyWords(query)
        } catch {
            results = []
            searchFailed = true
        }
    }

    @MainActor
    private func save() {
        isSaving = true
        errorText = nil
        let name = title.trimmingCharacters(in: .whitespaces)
        // The order words were picked in IS the study order the server stores.
        let ids = picked.map(\.id)
        Task {
            defer { isSaving = false }
            do {
                if let editing {
                    try await session.student.updateVocabularySet(id: editing.id, title: name, wordIds: ids)
                } else {
                    try await session.student.createVocabularySet(title: name, wordIds: ids)
                }
                onDone(true)
            } catch let error as APIError {
                errorText = error.errorDescription
            } catch {
                errorText = error.localizedDescription
            }
        }
    }
}
