import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import MasterSATKit

/// One homework: what was asked, what has been handed in, and how to hand more in.
///
/// On a phone the dominant case is "photograph the work I did on paper", so the photo
/// picker leads and the file browser sits behind it.
struct HomeworkDetailView: View {
    let assignment: AssignmentListing

    @Environment(Session.self) private var session
    @State private var submission: Submission?
    @State private var loadError: String?
    @State private var isLoading = true

    /// Files chosen but not yet uploaded. They keep their token from the moment they are
    /// picked, so a retry after a failure re-sends the same identity and the server
    /// deduplicates instead of storing two copies.
    @State private var staged: [MultipartForm.File] = []
    @State private var photoSelections: [PhotosPickerItem] = []
    @State private var isImportingFile = false
    @State private var isUploading = false
    @State private var actionError: String?

    // Opening attached content
    @State private var startingKey: String?
    @State private var assessmentAttemptId: Int?
    @State private var reviewAttemptId: Int?
    @State private var examRoute: ExamRoute?

    private var classroomId: Int? { assignment.classroomId }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if classroomId == nil {
                ContentUnavailableView(
                    "This homework has no classroom",
                    systemImage: "questionmark.folder",
                    description: Text("Ask your teacher — it cannot be submitted from here.")
                )
            } else {
                content
            }
        }
        .navigationTitle("Homework")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var content: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(assignment.title).font(.headline)
                    if let instructions = assignment.instructions, !instructions.isEmpty {
                        RichText(html: instructions)
                    }
                    HStack(spacing: 8) {
                        Text(StatusLabel.homework(submission?.workflowStatus ?? assignment.workflowStatus))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(StatusLabel.color(submission?.workflowStatus ?? assignment.workflowStatus))
                        if let due = assignment.dueAt, let date = JSONCoding.parseServerDate(due) {
                            Text("· Due \(date.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption)
                                .foregroundStyle(assignment.isOverdue ? .orange : .secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
            }

            if let note = submission?.returnNote, !note.isEmpty {
                Section("From your teacher") {
                    // A returned homework is an invitation to revise, so the note leads.
                    Text(note).font(.subheadline)
                }
            }

            contentSections

            if let files = submission?.files, !files.isEmpty {
                Section("Handed in") {
                    ForEach(files) { file in
                        SubmittedFileRow(file: file) { await remove(file) }
                    }
                }
            }

            if !staged.isEmpty {
                Section("Ready to send") {
                    ForEach(Array(staged.enumerated()), id: \.element.token) { index, file in
                        HStack(spacing: 10) {
                            Image(systemName: "doc").foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(file.filename).font(.subheadline)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(file.data.count), countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                staged.remove(at: index)
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if !assignment.locksFileUpload {
                Section {
                    PhotosPicker(selection: $photoSelections, matching: .images) {
                        Label("Add photos", systemImage: "camera")
                    }
                    Button {
                        isImportingFile = true
                    } label: {
                        Label("Add a file", systemImage: "doc.badge.plus")
                    }

                    Button(action: submit) {
                        if isUploading {
                            HStack { ProgressView().controlSize(.small); Text("Sending…") }
                        } else {
                            Label(
                                submission?.hasBeenSubmitted == true ? "Send again" : "Hand in",
                                systemImage: "paperplane"
                            )
                            .fontWeight(.semibold)
                        }
                    }
                    .disabled(isUploading || (staged.isEmpty && submission?.files.isEmpty != false))
                } header: {
                    Text("Hand in")
                } footer: {
                    if let actionError {
                        Text(actionError).foregroundStyle(.red)
                    } else if staged.isEmpty && submission?.files.isEmpty != false {
                        Text("Add a photo of your work, or a file, then hand it in.")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationDestination(item: $reviewAttemptId) { id in
            AssessmentReviewView(attemptId: id)
        }
        .fullScreenCover(item: $assessmentAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                assessmentAttemptId = nil
                Task { await load() }
            }
        }
        .fullScreenCover(item: $examRoute) { route in
            if case .runner(let attemptId, let backend) = route {
                ExamContainerView(attemptId: attemptId, backend: backend) { examRoute = nil }
            }
        }
        .onChange(of: photoSelections) { _, items in
            Task { await stagePhotos(items) }
        }
        .fileImporter(
            isPresented: $isImportingFile,
            allowedContentTypes: [.pdf, .image, .plainText, .rtf, .presentation, .spreadsheet, .content],
            allowsMultipleSelection: true
        ) { result in
            Task { await stageFiles(result) }
        }
    }

    // MARK: - Attached content

    /// Everything the teacher bundled into this homework, each openable from here.
    ///
    /// A homework is not one thing: it can carry several assessments, several vocabulary
    /// sets, past-paper sections, a mock, files and links, all at once. The web launcher
    /// shows them all; anything left out here would simply be unreachable on a phone.
    @ViewBuilder
    private var contentSections: some View {
        if !assignment.assessmentHomeworks.isEmpty {
            Section("Assessments") {
                ForEach(assignment.assessmentHomeworks) { link in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(link.title).font(.subheadline.weight(.medium))
                            Text(contentSubtitle(link)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if link.progress?.isCompleted == true, let attemptId = link.progress?.attemptId {
                            Button("Review") { reviewAttemptId = attemptId }
                                .buttonStyle(.bordered)
                        } else {
                            Button {
                                openAssessment(link)
                            } label: {
                                if startingKey == "quiz.\(link.homeworkId)" {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Text(link.progress?.isInProgress == true ? "Continue" : "Start").bold()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Theme.accent)
                            .disabled(startingKey != nil)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }

        if !assignment.vocabHomeworks.isEmpty {
            Section("Vocabulary") {
                ForEach(assignment.vocabHomeworks) { link in
                    NavigationLink {
                        VocabSetView(setId: link.setId, title: link.setTitle)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: link.state == "completed" ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(link.state == "completed" ? .green : .secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.setTitle).font(.subheadline.weight(.medium))
                                // Sets are numbered per section, so "Set 1" collides
                                // constantly — the section is what tells them apart.
                                Text([link.sectionTitle, "\(link.wordCount) words"]
                                    .filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }

        if !assignment.practiceBundleTests.isEmpty {
            Section("Papers") {
                ForEach(assignment.practiceBundleTests) { test in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(test.name).font(.subheadline.weight(.medium))
                            Text(test.subject.humanisedSubject).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            openPastpaper(test)
                        } label: {
                            if startingKey == "paper.\(test.id)" {
                                ProgressView().controlSize(.small)
                            } else {
                                Text(test.state == "in_progress" ? "Resume" : "Start").bold()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                        .disabled(startingKey != nil)
                    }
                    .padding(.vertical, 2)
                }
            }
        }

        if let mockId = assignment.mockExamId {
            Section("Mock exam") {
                HStack {
                    Text("Full mock").font(.subheadline.weight(.medium))
                    Spacer()
                    Button {
                        openMock(mockId)
                    } label: {
                        if startingKey == "mock.\(mockId)" {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Start").bold()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(startingKey != nil)
                }
            }
        }

        if !assignment.attachments.isEmpty || !assignment.externalURLs.isEmpty || hasVideo {
            Section("Materials") {
                ForEach(assignment.attachments) { file in
                    if let url = URL(string: file.url) {
                        Link(destination: url) {
                            Label(file.fileName, systemImage: "doc")
                        }
                    }
                }
                ForEach(assignment.externalURLs, id: \.self) { raw in
                    if let url = URL(string: raw) {
                        Link(destination: url) {
                            Label(url.host ?? raw, systemImage: "link")
                        }
                    }
                }
                if let raw = assignment.videoURL ?? assignment.videoFileURL,
                   !raw.isEmpty, let url = URL(string: raw) {
                    Link(destination: url) {
                        Label("Lesson video", systemImage: "play.rectangle")
                    }
                }
            }
        }
    }

    private var hasVideo: Bool {
        (assignment.videoURL?.isEmpty == false) || (assignment.videoFileURL?.isEmpty == false)
    }

    private func contentSubtitle(_ link: AssessmentHomeworkLink) -> String {
        var parts: [String] = []
        if link.questionCount > 0 { parts.append("\(link.questionCount) questions") }
        if let progress = link.progress {
            if progress.isCompleted, let percent = progress.percent {
                parts.append("\(ScoreText.string(percent))%")
            } else if progress.isInProgress, let answered = progress.answeredCount {
                parts.append("\(answered) answered")
            }
        }
        return parts.joined(separator: " · ")
    }

    @MainActor
    private func openAssessment(_ link: AssessmentHomeworkLink) {
        startingKey = "quiz.\(link.homeworkId)"
        Task {
            defer { startingKey = nil }
            do {
                let attempt = try await session.assessments.start(homeworkId: link.homeworkId)
                assessmentAttemptId = attempt.id
            } catch let error as APIError {
                actionError = error.errorDescription
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func openPastpaper(_ test: PracticeBundleTest) {
        startingKey = "paper.\(test.id)"
        Task {
            defer { startingKey = nil }
            do {
                let attempt = try await session.student.startPastpaperAttempt(practiceTestId: test.id)
                examRoute = .runner(attemptId: attempt.id, backend: .exams)
            } catch let error as APIError {
                actionError = error.errorDescription
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func openMock(_ mockId: Int) {
        startingKey = "mock.\(mockId)"
        Task {
            defer { startingKey = nil }
            do {
                let attempt = try await session.student.startMockAttempt(mockId: mockId)
                examRoute = .runner(attemptId: attempt.id, backend: .mocks)
            } catch let error as APIError {
                actionError = error.errorDescription
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    // MARK: - Staging

    @MainActor
    private func stagePhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for (offset, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            // Camera roll items have no useful filename, so name them for the teacher who
            // will open them: a list of "image.jpg" is unreadable. The extension comes from
            // the bytes, not a guess — a screenshot is a PNG and a recent iPhone photo may
            // be HEIC, and the server validates uploads by extension.
            let kind = MultipartForm.imageKind(for: data)
            let stamp = Int(Date().timeIntervalSince1970)
            staged.append(MultipartForm.File(
                filename: "photo-\(stamp)-\(offset + 1).\(kind.extension)",
                mimeType: kind.mimeType,
                data: data
            ))
        }
        photoSelections = []
    }

    @MainActor
    private func stageFiles(_ result: Result<[URL], Error>) async {
        switch result {
        case .success(let urls):
            for url in urls {
                // A file picked from iCloud or another app is outside the sandbox until
                // access is opened, and it must be closed again or the grant leaks.
                let opened = url.startAccessingSecurityScopedResource()
                defer { if opened { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else {
                    actionError = "Could not read \(url.lastPathComponent)."
                    continue
                }
                staged.append(MultipartForm.File(
                    filename: url.lastPathComponent,
                    mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream",
                    data: data
                ))
            }
        case .failure(let error):
            actionError = error.localizedDescription
        }
    }

    // MARK: - Sending

    @MainActor
    private func submit() {
        guard let classroomId else { return }
        isUploading = true
        actionError = nil
        Task {
            defer { isUploading = false }
            do {
                let updated = try await session.student.submitHomework(
                    classroomId: classroomId,
                    assignmentId: assignment.id,
                    files: staged,
                    expectedRevision: submission?.revision
                )
                // Only clear the staged files once the server has them.
                staged = []
                submission = updated
            } catch let error as APIError {
                actionError = error.errorDescription
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func remove(_ file: SubmissionFile) async {
        guard let classroomId else { return }
        actionError = nil
        do {
            submission = try await session.student.submitHomework(
                classroomId: classroomId,
                assignmentId: assignment.id,
                removeFileIds: [file.id],
                expectedRevision: submission?.revision,
                markAsSubmitted: false
            )
        } catch let error as APIError {
            actionError = error.errorDescription
        } catch {
            actionError = error.localizedDescription
        }
    }

    @MainActor
    private func load() async {
        guard let classroomId else {
            isLoading = false
            return
        }
        loadError = nil
        do {
            submission = try await session.student.mySubmission(
                classroomId: classroomId,
                assignmentId: assignment.id
            )
        } catch APIError.http(let status, _) where status == 404 {
            // Nothing handed in yet is a normal state, not a failure.
            submission = nil
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct SubmittedFileRow: View {
    let file: SubmissionFile
    let onRemove: @MainActor () async -> Void

    @State private var isRemoving = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "paperclip").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(file.displayName).font(.subheadline)
                if let type = file.fileType, !type.isEmpty {
                    Text(type).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if isRemoving {
                ProgressView().controlSize(.small)
            } else {
                Button {
                    isRemoving = true
                    Task {
                        await onRemove()
                        isRemoving = false
                    }
                } label: {
                    Image(systemName: "trash").foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
