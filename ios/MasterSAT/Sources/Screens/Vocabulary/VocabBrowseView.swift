import SwiftUI
import MasterSATKit

/// The whole published word bank, not just what was assigned.
///
/// A student who wants to get ahead should not have to wait for a teacher to set a set.
struct VocabBrowseView: View {
    @Environment(Session.self) private var session
    @State private var sections: [VocabSection] = []
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        Group {
            if isLoading && sections.isEmpty {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else if sections.isEmpty {
                ContentUnavailableView(
                    "The bank is empty",
                    systemImage: "books.vertical",
                    description: Text("Word sections will appear here once they are published.")
                )
            } else {
                List(sections) { section in
                    NavigationLink {
                        VocabSectionView(sectionId: section.id, title: section.title)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(section.title).font(.subheadline.weight(.medium))
                            Text("\(section.setCount) sets · \(section.wordCount) words")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ProgressBar(progress: section.progress)
                        }
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("Word bank")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor
    private func load() async {
        isLoading = sections.isEmpty
        loadError = nil
        do {
            sections = try await session.student.vocabularySections()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct VocabSectionView: View {
    let sectionId: Int
    let title: String

    @Environment(Session.self) private var session
    @State private var detail: VocabSectionDetail?
    @State private var loadError: String?

    var body: some View {
        Group {
            if let detail {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            if let description = detail.description, !description.isEmpty {
                                Text(description).font(.subheadline)
                            }
                            Text("\(detail.progress.mastered) of \(detail.wordCount) words mastered")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ProgressBar(progress: detail.progress)
                        }
                        .padding(.vertical, 4)
                    }
                    Section("Sets") {
                        ForEach(detail.sets) { set in
                            NavigationLink {
                                VocabSetView(setId: set.id, title: set.title)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: set.completed ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(set.completed ? .green : .secondary)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(set.title).font(.subheadline.weight(.medium))
                                        Text("\(set.wordCount) words").font(.caption).foregroundStyle(.secondary)
                                        ProgressBar(progress: set.progress)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor
    private func load() async {
        loadError = nil
        do {
            detail = try await session.student.vocabularySection(id: sectionId)
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// The three buckets as one bar.
struct ProgressBar: View {
    let progress: VocabProgress

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 1) {
                segment(progress.mastered, .green, geometry.size.width)
                segment(progress.learning, .orange, geometry.size.width)
                Rectangle().fill(Color(.tertiarySystemFill))
            }
        }
        .frame(height: 6)
        .clipShape(Capsule())
    }

    private func segment(_ count: Int, _ colour: Color, _ width: CGFloat) -> some View {
        // Guarded: a set with no words at all would otherwise divide by zero and the bar
        // would come out NaN-wide, which SwiftUI draws as nothing at all.
        let fraction = progress.total > 0 ? CGFloat(count) / CGFloat(progress.total) : 0
        return Rectangle().fill(colour).frame(width: max(0, width * fraction))
    }
}

/// The student's own sets.
struct MySetsView: View {
    @Environment(Session.self) private var session
    @State private var sets: [VocabMySet] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var isBuilding = false

    var body: some View {
        Group {
            if isLoading && sets.isEmpty {
                ProgressView()
            } else if let loadError {
                RetryNotice(message: loadError) { await load() }
            } else if sets.isEmpty {
                ContentUnavailableView {
                    Label("No sets of your own yet", systemImage: "folder.badge.person.crop")
                } description: {
                    Text("Build one from words you want to work on.")
                } actions: {
                    Button("Build a set") { isBuilding = true }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                }
            } else {
                List {
                    ForEach(sets) { set in
                        NavigationLink {
                            VocabSetView(setId: set.id, title: set.title)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: set.completed ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(set.completed ? .green : .secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(set.title).font(.subheadline.weight(.medium))
                                    Text("\(set.wordCount) words").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .onDelete { offsets in
                        Task { await delete(offsets) }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .navigationTitle("My sets")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isBuilding = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $isBuilding) {
            CustomSetBuilderView { isBuilding = false; Task { await load() } }
        }
        .task { await load() }
    }

    @MainActor
    private func delete(_ offsets: IndexSet) async {
        for index in offsets {
            let set = sets[index]
            do {
                try await session.student.deleteVocabularySet(id: set.id)
            } catch let error as APIError {
                loadError = error.errorDescription
            } catch {
                loadError = error.localizedDescription
            }
        }
        await load()
    }

    @MainActor
    private func load() async {
        isLoading = sets.isEmpty
        loadError = nil
        do {
            sets = try await session.student.myVocabularySets()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

/// Building a set: search the bank, pick words, name it.
struct CustomSetBuilderView: View {
    let onDone: @MainActor () -> Void

    @Environment(Session.self) private var session
    @State private var title = ""
    @State private var query = ""
    @State private var results: [VocabWord] = []
    @State private var picked: [VocabWord] = []
    @State private var isSearching = false
    @State private var isSaving = false
    @State private var errorText: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                Section("Name") {
                    TextField("What is this set for?", text: $title)
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
                            }
                        }
                    }
                }

                Section {
                    if isSearching {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if results.isEmpty {
                        Text(query.isEmpty ? "Search the bank for words to add." : "Nothing matches.")
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
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } header: {
                    Text("Add words")
                } footer: {
                    if let errorText { Text(errorText).foregroundStyle(.red) }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $query, prompt: "Search words")
            .onChange(of: query) { _, _ in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    if Task.isCancelled { return }
                    await search()
                }
            }
            .navigationTitle("New set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDone() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSaving { ProgressView() } else { Text("Save").bold() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || picked.isEmpty || isSaving)
                }
            }
        }
    }

    @MainActor
    private func search() async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            results = try await session.student.searchVocabularyWords(query)
        } catch {
            results = []
        }
    }

    @MainActor
    private func save() {
        isSaving = true
        errorText = nil
        Task {
            defer { isSaving = false }
            do {
                // The order words were picked in IS the study order the server stores.
                try await session.student.createVocabularySet(
                    title: title.trimmingCharacters(in: .whitespaces),
                    wordIds: picked.map(\.id)
                )
                onDone()
            } catch let error as APIError {
                errorText = error.errorDescription
            } catch {
                errorText = error.localizedDescription
            }
        }
    }
}
