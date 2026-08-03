import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers
import MasterSATKit

/// One homework: what was asked, what to do, and how to hand it in.
///
/// The order is the order a student works in — watch the lesson, do the tasks, then hand
/// something in. The upload box used to lead; it now sits last, because on most homework
/// the work IS the attached quiz or word set, not a photo.
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
        .background(Theme.background)
        .navigationTitle("Homework")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $reviewAttemptId) { id in
            AssessmentReviewView(attemptId: id)
        }
        .fullScreenCover(item: $assessmentAttemptId) { id in
            AssessmentRunnerView(attemptId: id) {
                assessmentAttemptId = nil
                Task { await load() }
            }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerCard
                if let note = submission?.returnNote, !note.isEmpty { returnNote(note) }
                lessonVideo
                taskSection
                materialsSection
                handInSection
            }
            .padding(16)
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

    // MARK: - Header

    /// The site's assignment hero, then the instructions under it.
    ///
    /// The instructions are deliberately NOT inside the gradient: they are authored HTML in
    /// the platform's own type, and a coloured panel behind them would fight every heading
    /// and list a teacher writes.
    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HeroHeader(
                eyebrow: assignment.classroomName?.isEmpty == false ? assignment.classroomName! : "Homework",
                eyebrowIcon: "checklist",
                title: assignment.title,
                tiles: heroTiles
            )

            HStack(spacing: 8) {
                let status = submission?.workflowStatus ?? assignment.workflowStatus
                Chip(text: StatusLabel.homework(status), tone: StatusLabel.tone(status))
                if let due = DueLabel.text(assignment.dueAt) {
                    // A passed deadline reads as an invitation to catch up, never as an
                    // accusation.
                    Chip(text: due.text, icon: "calendar", tone: due.late ? .warning : .neutral)
                }
            }

            if let instructions = assignment.instructions, !instructions.isEmpty {
                RichText(html: instructions).cardStyle()
            }
        }
    }

    private var heroTiles: [HeroTile] {
        var tiles: [HeroTile] = []
        if !assignment.assessmentHomeworks.isEmpty {
            tiles.append(HeroTile("Quizzes", icon: "square.and.pencil", value: assignment.assessmentHomeworks.count))
        }
        if !assignment.vocabHomeworks.isEmpty {
            tiles.append(HeroTile("Word sets", icon: "character.book.closed", value: assignment.vocabHomeworks.count))
        }
        if let due = DueLabel.text(assignment.dueAt) {
            tiles.append(HeroTile("Deadline", icon: "calendar", value: due.text))
        }
        return tiles
    }

    private func returnNote(_ note: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("From your teacher", systemImage: "text.bubble.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.warning)
            // A returned homework is an invitation to revise, so the note leads.
            Text(note).font(.system(size: 15))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.warningSoft)
        )
    }

    // MARK: - Lesson video

    /// The teacher's lesson video, prominent.
    ///
    /// An uploaded file plays right here — it is the lesson, and making a student leave the
    /// app to watch it is how a lesson goes unwatched. A YouTube or Drive link cannot be
    /// played inline without embedding their player, so it gets a real card that says where
    /// it goes rather than a bare blue link.
    @ViewBuilder
    private var lessonVideo: some View {
        if let raw = assignment.videoFileURL, !raw.isEmpty, let url = URL(string: raw) {
            VStack(alignment: .leading, spacing: 8) {
                Overline("Lesson")
                VideoPlayer(player: AVPlayer(url: url))
                    .frame(height: 210)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            }
        } else if let raw = assignment.videoURL, !raw.isEmpty, let url = URL(string: raw) {
            VStack(alignment: .leading, spacing: 8) {
                Overline("Lesson")
                Link(destination: url) {
                    HStack(spacing: 14) {
                        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                            .fill(Theme.danger.opacity(0.12))
                            .frame(width: 54, height: 54)
                            .overlay(
                                Image(systemName: "play.fill")
                                    .font(.system(size: 20))
                                    .foregroundStyle(Theme.danger)
                            )
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Watch the lesson video")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.primary)
                            Text(url.host ?? raw)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textLabel)
                    }
                    .cardStyle()
                }
            }
        }
    }

    // MARK: - Tasks

    /// Everything the teacher bundled into this homework, as tasks to work through.
    ///
    /// A homework is not one thing: it can carry several assessments and several
    /// vocabulary sets at once. They share one list because to a student they are one list
    /// — "what do I have to do" — rather than two kinds of object.
    @ViewBuilder
    private var taskSection: some View {
        let hasTasks = !assignment.assessmentHomeworks.isEmpty || !assignment.vocabHomeworks.isEmpty
        if hasTasks {
            VStack(alignment: .leading, spacing: 10) {
                Overline("What to do")

                ForEach(assignment.assessmentHomeworks) { link in
                    TaskRow(
                        title: link.title,
                        subtitle: assessmentSubtitle(link),
                        icon: "square.and.pencil",
                        tone: Theme.success,
                        state: link.progress?.isCompleted == true
                            ? .done(label: (link.progress?.missedCount ?? 0) > 0 ? "Review" : "Review answers")
                            : .todo(label: link.progress?.isInProgress == true ? "Continue" : "Start"),
                        isBusy: startingKey == "quiz.\(link.homeworkId)"
                    ) {
                        if link.progress?.isCompleted == true, let attemptId = link.progress?.attemptId {
                            reviewAttemptId = attemptId
                        } else {
                            openAssessment(link)
                        }
                    }
                }

                ForEach(assignment.vocabHomeworks) { link in
                    NavigationLink {
                        VocabSetView(setId: link.setId, title: link.setTitle)
                    } label: {
                        TaskRowLabel(
                            title: link.setTitle,
                            // Sets are numbered per section, so "Set 1" collides
                            // constantly — the section is what tells them apart.
                            subtitle: [link.sectionTitle, "\(link.wordCount) words"]
                                .filter { !$0.isEmpty }.joined(separator: " · "),
                            icon: "character.book.closed.fill",
                            tone: Theme.accent,
                            state: link.state == "completed"
                                ? .done(label: "Practise again")
                                : .todo(label: link.state == "in_progress" ? "Continue" : "Study"),
                            isBusy: false
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func assessmentSubtitle(_ link: AssessmentHomeworkLink) -> String {
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

    // MARK: - Materials

    @ViewBuilder
    private var materialsSection: some View {
        if !assignment.attachments.isEmpty || !assignment.externalURLs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Overline("Materials")
                ForEach(assignment.attachments) { file in
                    if let url = URL(string: file.url) {
                        Link(destination: url) {
                            materialRow(file.fileName, icon: "doc.fill")
                        }
                    }
                }
                ForEach(assignment.externalURLs, id: \.self) { raw in
                    if let url = URL(string: raw) {
                        Link(destination: url) {
                            materialRow(url.host ?? raw, icon: "link")
                        }
                    }
                }
            }
        }
    }

    private func materialRow(_ label: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 15)).foregroundStyle(Theme.accent).frame(width: 22)
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
            Spacer()
            Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(Theme.textLabel)
        }
        .cardStyle(padding: 13)
    }

    // MARK: - Handing in

    @ViewBuilder
    private var handInSection: some View {
        if !assignment.locksFileUpload {
            VStack(alignment: .leading, spacing: 10) {
                Overline("Hand in")

                if let files = submission?.files, !files.isEmpty {
                    ForEach(files) { file in
                        SubmittedFileRow(file: file) { await remove(file) }
                    }
                }

                ForEach(Array(staged.enumerated()), id: \.element.token) { index, file in
                    HStack(spacing: 10) {
                        Image(systemName: "doc.badge.plus").foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(file.filename).font(.system(size: 14, weight: .medium))
                            Text(ByteCountFormatter.string(fromByteCount: Int64(file.data.count), countStyle: .file))
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        Button {
                            staged.remove(at: index)
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textLabel)
                        }
                        .buttonStyle(.plain)
                    }
                    .cardStyle(padding: 13)
                }

                HStack(spacing: 10) {
                    PhotosPicker(selection: $photoSelections, matching: .images) {
                        Label("Photo", systemImage: "camera.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))

                    Button { isImportingFile = true } label: {
                        Label("File", systemImage: "doc.badge.plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                }

                Button(action: submit) {
                    if isUploading {
                        HStack(spacing: 8) {
                            ProgressView().tint(.white)
                            Text("Sending…")
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        Label(
                            submission?.hasBeenSubmitted == true ? "Send again" : "Hand in",
                            systemImage: "paperplane.fill"
                        )
                        .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(isUploading || (staged.isEmpty && submission?.files.isEmpty != false))

                if let actionError {
                    Text(actionError).font(.system(size: 13)).foregroundStyle(Theme.danger)
                } else if staged.isEmpty && submission?.files.isEmpty != false {
                    Text("Add a photo of your work, or a file, then hand it in.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        } else if let actionError {
            Text(actionError).font(.system(size: 13)).foregroundStyle(Theme.danger)
        }
    }

    // MARK: - Opening content

    @MainActor
    private func openAssessment(_ link: AssessmentHomeworkLink) {
        startingKey = "quiz.\(link.homeworkId)"
        Task {
            defer { startingKey = nil }
            do {
                // Resumes the live attempt rather than opening a second one, so tapping
                // Continue twice cannot restart a half-finished quiz from scratch.
                let attempt = try await session.assessments.start(homeworkId: link.homeworkId)
                assessmentAttemptId = attempt.id
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

/// One thing to do, with the state it is in.
enum TaskState {
    case todo(label: String)
    case done(label: String)
}

struct TaskRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    let state: TaskState
    let isBusy: Bool
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            TaskRowLabel(title: title, subtitle: subtitle, icon: icon, tone: tone, state: state, isBusy: isBusy)
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
    }
}

struct TaskRowLabel: View {
    let title: String
    let subtitle: String
    let icon: String
    let tone: Color
    let state: TaskState
    let isBusy: Bool

    private var isDone: Bool {
        if case .done = state { return true }
        return false
    }

    private var actionLabel: String {
        switch state {
        case .todo(let label), .done(let label): return label
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(tone.opacity(0.12))
                .frame(width: 44, height: 44)
                .overlay(
                    Image(systemName: isDone ? "checkmark" : icon)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(isDone ? Theme.success : tone)
                )
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if isBusy {
                ProgressView()
            } else {
                Text(actionLabel)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(isDone ? Theme.textSecondary : .white)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(isDone ? Theme.surface2 : tone))
            }
        }
        .cardStyle(padding: 13)
        .contentShape(Rectangle())
    }
}

struct SubmittedFileRow: View {
    let file: SubmissionFile
    let onRemove: @MainActor () async -> Void

    @State private var isRemoving = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "paperclip").foregroundStyle(Theme.textSecondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(file.displayName).font(.system(size: 14, weight: .medium))
                if let type = file.fileType, !type.isEmpty {
                    Text(type).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer()
            if isRemoving {
                ProgressView()
            } else {
                Button {
                    isRemoving = true
                    Task {
                        await onRemove()
                        isRemoving = false
                    }
                } label: {
                    Image(systemName: "trash").foregroundStyle(Theme.danger)
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle(padding: 13)
    }
}
