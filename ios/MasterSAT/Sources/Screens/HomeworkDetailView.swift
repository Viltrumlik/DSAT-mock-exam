import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers
import MasterSATKit

/// One homework — or one lesson's classwork: what was asked, what to do, and how to hand it in.
///
/// The order is the order a student works in — the hero with its dates, the instructions,
/// the lesson video, the tasks, the materials, then handing something in. Classwork is the
/// same page in its own variant: work already done in the room, so no deadline, nothing to
/// hand in, and the teacher's XP where the countdown would be.
struct HomeworkDetailView: View {
    /// The list row this screen was opened from, when there was one. It knows things about
    /// THIS student the detail endpoint does not (status, class), and the detail knows what
    /// the teacher wrote — the page shows the two merged.
    private let seed: AssignmentListing?
    private let classroomHint: Int?
    private let assignmentId: Int

    init(assignment: AssignmentListing) {
        seed = assignment
        classroomHint = assignment.classroomId
        assignmentId = assignment.id
    }

    /// From a link that carries only ids (a notification, a deep link).
    init(classroomId: Int, assignmentId: Int) {
        seed = nil
        classroomHint = classroomId
        self.assignmentId = assignmentId
    }

    @Environment(Session.self) private var session
    @State private var detail: AssignmentListing?
    @State private var detailError: String?
    @State private var submission: Submission?
    /// The hand-in could not be read. Its section says so rather than offering a first
    /// hand-in over work that may already be there.
    @State private var submissionError: String?
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

    /// The row, enriched — never replaced — by the detail (see `AssignmentListing.merging`).
    private var current: AssignmentListing? {
        switch (seed, detail) {
        case let (seed?, detail?): return seed.merging(detail: detail)
        case let (seed?, nil): return seed
        case let (nil, detail?): return classroomHint.map { detail.inClassroom(id: $0, name: nil) } ?? detail
        case (nil, nil): return nil
        }
    }

    private var classroomId: Int? { current?.classroomId ?? classroomHint }

    var body: some View {
        Group {
            if let current, current.classroomId != nil {
                content(current)
            } else if current != nil {
                ContentUnavailableView(
                    "This homework has no classroom",
                    systemImage: "questionmark.folder",
                    description: Text("Ask your teacher — it cannot be submitted from here.")
                )
            } else if detailError != nil {
                ScrollView {
                    ClassroomErrorState(
                        title: "Assignment not available",
                        message: "It may have been removed, or it is not open to you yet."
                    ) { await load() }
                    .padding(16)
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Opening assignment…")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .navigationTitle("")
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

    private func content(_ a: AssignmentListing) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(a)
                if detailError != nil {
                    // The list row is on screen, but the teacher's side of it — instructions,
                    // files, the papers — did not arrive. Said, not silently left out.
                    Label("Some of this homework could not be loaded just now. Pull down to try again.", systemImage: "exclamationmark.triangle")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                // Keyed off the submission's own status (DRAFT/SUBMITTED/REVIEWED/RETURNED).
                // The web keys off `workflow_status` against the wrong value set, which is why a
                // graded homework there shows "To do" and hides its feedback — not copied.
                if let submission, let review = submission.review,
                   ["REVIEWED", "RETURNED"].contains((submission.status ?? "").uppercased()) {
                    reviewCard(review, returned: submission.isReturned)
                }
                if let note = submission?.returnNote, !note.isEmpty { returnNote(note) }
                lessonVideo(a)
                taskSection(a)
                materialsSection(a)
                handInSection(a)
            }
            .padding(16)
        }
        .refreshable { await load() }
        .onChange(of: photoSelections) { _, items in
            Task { await stagePhotos(items, limits: a.submissionLimits ?? .standard) }
        }
        .fileImporter(
            isPresented: $isImportingFile,
            allowedContentTypes: [.pdf, .image, .plainText, .presentation, .spreadsheet, .content],
            allowsMultipleSelection: true
        ) { result in
            Task { await stageFiles(result, limits: a.submissionLimits ?? .standard) }
        }
    }

    // MARK: - Header

    /// With the teacher already — its deadline is a date, not something to catch up on.
    private func isHandedIn(_ a: AssignmentListing) -> Bool {
        ["submitted", "graded", "reviewed"].contains((submission?.workflowStatus ?? a.workflowStatus ?? "").lowercased())
    }

    /// The site's assignment hero — the kind of work, the title, and its dates — then the
    /// instructions under it.
    ///
    /// The instructions are deliberately NOT inside the gradient: they are authored HTML in
    /// the platform's own type, and a coloured panel behind them would fight every heading
    /// and list a teacher writes.
    private func header(_ a: AssignmentListing) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HeroHeader(
                eyebrow: HomeworkWording.badge(for: a),
                eyebrowIcon: a.isClasswork ? "rectangle.inset.filled.and.person.filled" : "checklist",
                title: a.title,
                blurb: a.classroomName.flatMap { $0.isEmpty ? nil : $0 },
                tiles: heroTiles(a)
            )

            if !a.isClasswork {
                let status = submission?.workflowStatus ?? a.workflowStatus
                Chip(text: StatusLabel.homework(status), tone: StatusLabel.tone(status))
            }

            if let instructions = a.instructions, !instructions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Overline("Instructions")
                    RichText(text: instructions).cardStyle()
                }
            }
        }
    }

    private func heroTiles(_ a: AssignmentListing) -> [HeroTile] {
        let section = HeroTile("Section", icon: "book.closed", value: HomeworkWording.sectionLabel(a.subject))
        if a.isClasswork {
            // Classwork has no deadline by rule, so a countdown could only ever say "No
            // deadline" beside work already done in class. It gets its XP instead.
            return [
                HeroTile("In class", icon: "calendar", value: HomeworkWording.shortDate(a.assignedAt)),
                section,
                HeroTile("XP", icon: "sparkles", value: a.classworkAwardState.tileValue),
            ]
        }
        return [
            HeroTile("Assigned", icon: "calendar", value: HomeworkWording.shortDate(a.assignedAt)),
            HeroTile("Due", icon: "calendar.badge.clock", value: a.dueAt == nil ? "No deadline" : HomeworkWording.shortDate(a.dueAt)),
            section,
            HeroTile("Countdown", icon: "clock", value: HomeworkWording.countdown(dueAt: a.dueAt, handedIn: isHandedIn(a))),
        ]
    }

    /// The teacher's mark, and what they said. First after the header, because once work has
    /// been marked this is the one thing a student opens the page to read.
    private func reviewCard(_ review: SubmissionReview, returned: Bool) -> some View {
        let tone = returned ? Theme.warning : Theme.success
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                IconTile(systemName: returned ? "arrow.uturn.backward.circle.fill" : "checkmark.seal.fill", tone: tone)
                VStack(alignment: .leading, spacing: 2) {
                    // The site's own titles: a returned piece is an invitation to revise.
                    Text(returned ? "Revision requested" : "Feedback").font(.system(size: 16, weight: .heavy))
                    if let at = review.reviewedAt {
                        Text(RelativeTime.short(at))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer(minLength: 0)
                if let score = review.scoreText {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(score)
                            .font(.system(size: 22, weight: .heavy).monospacedDigit())
                            .foregroundStyle(tone)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        if review.isAuto {
                            Text("Auto-marked")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
            if let feedback = review.feedback, !feedback.isEmpty {
                Text(feedback)
                    .font(.system(size: 15))
                    .fixedSize(horizontal: false, vertical: true)
            } else if !returned {
                Text("No written feedback — your score is shown above.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .cardStyle()
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
    private func lessonVideo(_ a: AssignmentListing) -> some View {
        if let raw = a.videoFileURL, !raw.isEmpty, let url = URL(string: raw) {
            VStack(alignment: .leading, spacing: 8) {
                Overline("Lesson")
                VideoPlayer(player: AVPlayer(url: url))
                    .frame(height: 210)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            }
        } else if let raw = a.videoURL, !raw.isEmpty, let url = URL(string: raw) {
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

    /// Everything the teacher bundled into this homework, as tasks to work through, in the
    /// site launcher's order: quizzes, the papers, then word sets.
    ///
    /// A homework is not one thing: it can carry several assessments, a past paper and
    /// several vocabulary sets at once. They share one list because to a student they are
    /// one list — "what do I have to do" — rather than three kinds of object.
    @ViewBuilder
    private func taskSection(_ a: AssignmentListing) -> some View {
        let papers = a.computerPapers
        if !a.assessmentHomeworks.isEmpty || !papers.isEmpty || !a.vocabHomeworks.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Overline("What to do")

                ForEach(a.assessmentHomeworks) { link in
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

                if !papers.isEmpty {
                    // Papers are sat on a computer, under exam conditions — named here, with
                    // where the student stands on each, but never started from the phone.
                    ForEach(papers) { ComputerPaperRow(paper: $0) }
                    Label("Open this on a computer — papers are sat there.", systemImage: "laptopcomputer")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 4)
                }

                ForEach(a.vocabHomeworks) { link in
                    NavigationLink {
                        // Bound to THIS homework, so the runs are credited to it rather than
                        // to the server's guess — a set can sit on two homeworks at once.
                        VocabSetView(setId: link.setId, title: link.setTitle, assignmentId: a.id)
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
        // `my-assignments` never sends `question_count`; the progress total is the count.
        let count = link.questionCount > 0 ? link.questionCount : (link.progress?.totalQuestions ?? 0)
        if count > 0 { parts.append("\(count) questions") }
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
    private func materialsSection(_ a: AssignmentListing) -> some View {
        if !a.attachments.isEmpty || !a.externalURLs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Overline("Materials")
                ForEach(a.attachments) { file in
                    if let url = URL(string: file.url) {
                        Link(destination: url) { AttachmentRow(file: file) }
                            .buttonStyle(.plain)
                    }
                }
                // Links carry the names the teacher gave them; an unnamed one shows its address.
                ForEach(a.namedLinks, id: \.url) { link in
                    if let url = URL(string: link.url) {
                        Link(destination: url) {
                            HStack(spacing: 12) {
                                IconTile(systemName: "link", tone: Theme.accent, size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(link.label.isEmpty ? (url.host ?? link.url) : link.label)
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    if !link.label.isEmpty {
                                        Text(url.host ?? link.url)
                                            .font(.system(size: 11))
                                            .foregroundStyle(Theme.textSecondary)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer()
                                Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(Theme.textLabel)
                            }
                            .cardStyle(padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Handing in

    @ViewBuilder
    private func handInSection(_ a: AssignmentListing) -> some View {
        let closed = a.isHandInClosed(submissionStatus: submission?.status)
        if a.offersFileUpload, isLoading, submission == nil, submissionError == nil {
            // Not offered until we know what is already handed in.
            VStack(alignment: .leading, spacing: 10) {
                Overline("Hand in")
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 16)
            }
        } else if a.offersFileUpload, let submissionError {
            // Not knowing what is already handed in is not "nothing handed in".
            VStack(alignment: .leading, spacing: 8) {
                Overline("Hand in")
                RetryNotice(message: "Could not load your hand-in just now. \(submissionError)") { await load() }
            }
        } else if a.offersFileUpload && closed {
            // Said before the student picks anything, rather than after an upload is refused.
            VStack(alignment: .leading, spacing: 10) {
                Overline("Hand in")
                if let files = submission?.files, !files.isEmpty {
                    ForEach(files) { file in
                        SubmittedFileRow(file: file, onRemove: nil)
                    }
                }
                Label(
                    (submission?.status ?? "").uppercased() == "REVIEWED"
                        ? "Your teacher has marked this — it can't be changed now."
                        : "Hand-in closed at the deadline.",
                    systemImage: "lock.fill"
                )
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            }
        } else if a.offersFileUpload {
            uploadCard(a)
        } else if let actionError {
            Text(actionError).font(.system(size: 13)).foregroundStyle(Theme.danger)
        }
    }

    private func uploadCard(_ a: AssignmentListing) -> some View {
        let limits = a.submissionLimits ?? .standard
        return VStack(alignment: .leading, spacing: 10) {
            Overline("Hand in")

            if let files = submission?.files, !files.isEmpty {
                ForEach(files) { file in
                    SubmittedFileRow(file: file) { await remove(file, assignmentId: a.id) }
                }
            }

            ForEach(Array(staged.enumerated()), id: \.element.token) { index, file in
                HStack(spacing: 10) {
                    Image(systemName: "doc.badge.plus").foregroundStyle(Theme.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(file.filename).font(.system(size: 14, weight: .medium))
                        Text(SubmissionLimits.megabytes(file.data.count))
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Button {
                        staged.remove(at: index)
                        actionError = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textLabel)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(file.filename)")
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

            Button { submit(a, limits: limits) } label: {
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
                Text(actionError)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            } else if staged.isEmpty && submission?.files.isEmpty != false {
                Text("Add a photo of your work, or a file, then hand it in. Up to \(limits.maxFilesPerSubmission) files, \(SubmissionLimits.megabytes(limits.maxFileBytes)) each.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
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

    /// Checked as it is picked, so a file the server would refuse is refused here, before
    /// the student waits for an upload to be told.
    @MainActor
    private func stage(_ file: MultipartForm.File, limits: SubmissionLimits) {
        if let problem = limits.problem(fileName: file.filename, bytes: file.data.count) {
            actionError = limits.message(for: problem)
            return
        }
        actionError = nil
        staged.append(file)
    }

    @MainActor
    private func stagePhotos(_ items: [PhotosPickerItem], limits: SubmissionLimits) async {
        guard !items.isEmpty else { return }
        for (offset, item) in items.enumerated() {
            guard let original = try? await item.loadTransferable(type: Data.self) else { continue }
            // Camera photos are re-encoded as JPEG before they leave the phone, for two
            // reasons. The server's upload allowlist has no `.heic`, so a recent iPhone photo
            // sent as-is was refused. And a camera JPEG/HEIC carries EXIF — including where
            // the photo was taken, which is the student's home more often than not; a fresh
            // JPEG keeps the pixels and the orientation and nothing else. Screenshots (PNG)
            // carry no location and go as they are.
            let (data, kind) = PhotoUpload.prepare(original)
            // Camera roll items have no useful filename, so name them for the teacher who
            // will open them: a list of "image.jpg" is unreadable.
            let stamp = Int(Date().timeIntervalSince1970)
            stage(MultipartForm.File(
                filename: "photo-\(stamp)-\(offset + 1).\(kind.extension)",
                mimeType: kind.mimeType,
                data: data
            ), limits: limits)
        }
        photoSelections = []
    }

    @MainActor
    private func stageFiles(_ result: Result<[URL], Error>, limits: SubmissionLimits) async {
        switch result {
        case .success(let urls):
            for url in urls {
                // A file picked from iCloud or another app is outside the sandbox until
                // access is opened, and it must be closed again or the grant leaks.
                let opened = url.startAccessingSecurityScopedResource()
                defer { if opened { url.stopAccessingSecurityScopedResource() } }
                // Size and type are checked BEFORE the file is read: a 500 MB video would
                // otherwise be pulled into memory only to be refused.
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? nil
                if let problem = limits.problem(fileName: url.lastPathComponent, bytes: size ?? 0) {
                    actionError = limits.message(for: problem)
                    continue
                }
                guard let data = try? Data(contentsOf: url) else {
                    actionError = "Could not read \(url.lastPathComponent)."
                    continue
                }
                stage(MultipartForm.File(
                    filename: url.lastPathComponent,
                    mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream",
                    data: data
                ), limits: limits)
            }
        case .failure(let error):
            actionError = error.localizedDescription
        }
    }

    // MARK: - Sending

    @MainActor
    private func submit(_ a: AssignmentListing, limits: SubmissionLimits) {
        guard let classroomId, !isUploading else { return }
        // The whole upload, once more, as it will be sent: the count the hand-in would reach
        // and the size of the one request.
        if let problem = limits.problem(
            files: staged.map { (name: $0.filename, bytes: $0.data.count) },
            alreadyHandedIn: submission?.files.count ?? 0
        ) {
            actionError = limits.message(for: problem)
            return
        }
        isUploading = true
        actionError = nil
        Task {
            defer { isUploading = false }
            do {
                let updated = try await session.student.submitHomework(
                    classroomId: classroomId,
                    assignmentId: a.id,
                    files: staged,
                    expectedRevision: submission?.revision
                )
                // Only clear the staged files once the server has them.
                staged = []
                submission = updated
            } catch APIError.validation(_, _, let fields) where fields["file_tokens"] != nil {
                // "Token already used": an earlier attempt DID land — its response was lost on
                // the way back. The files are already on the server, so re-read what it holds
                // instead of telling the student the upload failed and inviting a duplicate.
                staged = []
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
            } catch APIError.conflict(let detail) {
                // Changed somewhere else (another device, a teacher's return). Show what the
                // server holds now; the staged files stay, ready to send against it.
                actionError = detail.isEmpty ? "Submission was modified. Refresh and try again." : detail
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
            } catch APIError.http(413, _) {
                // Refused by the proxy before the server saw it; the body is an HTML page.
                actionError = "That upload is too big to send at once. Send fewer files at a time."
            } catch let error as APIError {
                actionError = error.errorDescription
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    @MainActor
    private func remove(_ file: SubmissionFile, assignmentId: Int) async {
        guard let classroomId else { return }
        actionError = nil
        do {
            submission = try await session.student.submitHomework(
                classroomId: classroomId,
                assignmentId: assignmentId,
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
        detailError = nil
        submissionError = nil
        // The detail enriches a list row; with no row (a deep link) it IS the page, and its
        // failure is the page's failure.
        async let fullAssignment = session.student.assignment(classroomId: classroomId, id: assignmentId)
        do {
            // nil is "nothing handed in yet" — a normal state, not a failure.
            submission = try await session.student.mySubmission(
                classroomId: classroomId,
                assignmentId: assignmentId
            )
        } catch let error as APIError {
            submissionError = error.errorDescription
        } catch {
            submissionError = error.localizedDescription
        }
        do {
            detail = try await fullAssignment
        } catch let error as APIError {
            detailError = error.errorDescription ?? "Assignment not available"
        } catch {
            detailError = error.localizedDescription
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

/// A past paper, mock or practice pack — named, with where the student stands on it, and
/// deliberately not a button: these are sat on a computer, never started from the phone.
/// A finished past-paper section offers its certificate, which is worth having anywhere.
struct ComputerPaperRow: View {
    let paper: ComputerPaper

    @State private var showingCertificate = false

    private var tone: Chip.Tone {
        switch paper.mode {
        case .review: return .success
        case .resume: return .warning
        case .start: return .neutral
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                IconTile(systemName: paper.mode == .review ? "checkmark" : "doc.text", tone: Theme.info, size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(paper.name)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text([paper.kind.rawValue, paper.subject].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                Chip(text: paper.stateLabel, tone: tone)
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint("Sat on a computer, not in the app")

            if let attemptId = paper.certificateAttemptId {
                Button { showingCertificate = true } label: {
                    Label("Certificate", systemImage: "rosette")
                        .font(.system(size: 13, weight: .bold))
                }
                .buttonStyle(SecondaryButtonStyle())
                .sheet(isPresented: $showingCertificate) {
                    PastPaperCertificateSheet(attemptId: attemptId, title: paper.name)
                }
            }
        }
        .cardStyle(padding: 13)
    }
}

/// A file the teacher attached: its type, its name and size, and Download.
private struct AttachmentRow: View {
    let file: AssignmentAttachment

    private var kind: MaterialKind { MaterialKind(fileName: file.fileName) }

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: kind.family == .image ? "photo.fill" : "doc.fill", tone: Theme.accent, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.fileName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text([kind.label, file.size.map(SubmissionLimits.megabytes)].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            Label("Download", systemImage: "arrow.down.circle")
                .labelStyle(.iconOnly)
                .font(.system(size: 18))
                .foregroundStyle(Theme.accent)
        }
        .cardStyle(padding: 12)
    }
}

struct SubmittedFileRow: View {
    let file: SubmissionFile
    /// `nil` once hand-in has closed: the file is shown, not offered for removal.
    let onRemove: (@MainActor () async -> Void)?

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
            } else if let onRemove {
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
                .accessibilityLabel("Remove \(file.displayName)")
            }
        }
        .cardStyle(padding: 13)
    }
}
