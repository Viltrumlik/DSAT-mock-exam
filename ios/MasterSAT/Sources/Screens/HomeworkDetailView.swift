import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers
import os
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
    @Environment(CelebrationCenter.self) private var celebrations
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Where the Hand in button is, so the confetti leaves from it. Boxed: it is written on every
    /// scroll frame and read only when the hand-in is celebrated.
    @State private var handInSpot = FrameBox()
    /// A small picture of each staged photo, by file token — made once, off the main thread.
    @State private var thumbnails: [String: UIImage] = [:]
    /// How far each staged file has gone up while the hand-in is sending.
    @State private var meter = UploadMeter()
    /// The files the hand-in on its way is carrying: only these rows show a ring (a file added
    /// while it goes is not in that request, so it has no progress to show).
    @State private var sendingTokens: Set<String> = []
    /// The last hand-in failed and its files are still here: the button offers to try again.
    @State private var sendFailed = false
    /// The header's XP when a quiz was opened — what its hand-in's gain is measured from.
    @State private var xpAtQuizStart: Int?

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
            // Celebrated the moment it is handed in; the cover keeps it waiting until it has gone.
            AssessmentRunnerView(attemptId: id, onSubmitted: {
                celebrations.celebrate(.assessment, xpBefore: xpAtQuizStart)
            }) {
                assessmentAttemptId = nil
                Task { await load() }
            }
            .coversCelebrations(celebrations)
            .noBarClearance()
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
        // Detached: `load` writes the submission first, and that re-render must not cancel the
        // assignment request still in flight.
        .detachedRefresh { await load() }
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

            ForEach(staged, id: \.token) { file in
                StagedFileRow(
                    file: file,
                    thumbnail: thumbnails[file.token],
                    meter: meter,
                    sending: sendingTokens.contains(file.token)
                ) {
                    withAnimation(Motion.focus) { staged.removeAll { $0.token == file.token } }
                    thumbnails[file.token] = nil
                    actionError = nil
                    sendFailed = false
                }
                .transition(reduceMotion ? .opacity : .scale(scale: 0.92).combined(with: .opacity))
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
                } else if sendFailed && !staged.isEmpty {
                    // Error, not empty: the files are still here, and one tap sends them again.
                    Label("Try again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
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
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { handInSpot.rect = $0 }

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
        // A light tap when a file is added — not when one is taken off or the hand-in clears them.
        .sensoryFeedback(.impact(weight: .light), trigger: staged.count) { old, new in new > old }
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
                xpAtQuizStart = celebrations.xpNow
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
        sendFailed = false
        withAnimation(Motion.focus) { staged.append(file) }
        guard file.mimeType.hasPrefix("image/") else { return }
        // Decoded and shrunk off the main thread: a camera photo is twelve megapixels. Until it is
        // ready the row shows a photo glyph; the picture fades in over it.
        let token = file.token
        let data = file.data
        Task {
            let small = await Task.detached(priority: .userInitiated) {
                await UIImage(data: data)?.byPreparingThumbnail(ofSize: CGSize(width: 176, height: 176))
            }.value
            guard let small, staged.contains(where: { $0.token == token }) else { return }
            withAnimation(Motion.focus) { thumbnails[token] = small }
        }
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
        let xpBefore = celebrations.xpNow
        isUploading = true
        actionError = nil
        sendFailed = false
        meter.reset()
        // One request carries every file; each row's ring shows its own file's share of it. The
        // files are fixed here: one added while this goes is not in the request.
        let files = staged
        let tokens = files.map(\.token)
        let carried = Set(tokens)
        sendingTokens = carried
        let progress = meter
        // URLSession reports from its own thread, as often as it likes; the relay keeps the newest
        // numbers and hands them to the main actor in one hop. A hand-in with nothing new to send
        // (a remove-only or an unchanged one) has no ring, so nothing is listening for it.
        let relay = UploadRelay { fractions in progress.report(fractions, tokens: tokens) }
        let onFileProgress: (@Sendable ([Double]) -> Void)? = files.isEmpty ? nil : { @Sendable fractions in relay.report(fractions) }
        Task {
            defer {
                relay.stop()
                sendingTokens = []
                isUploading = false
            }
            do {
                let updated = try await session.student.submitHomework(
                    classroomId: classroomId,
                    assignmentId: a.id,
                    files: files,
                    expectedRevision: submission?.revision,
                    onFileProgress: onFileProgress
                )
                // Confirmed: celebrated at once, before anything else is awaited, so the XP it is
                // measured from is the one at hand-in. Only what the server has leaves the staged
                // files, and the rows fade out as the submitted files come in.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInSpot.rect.celebrationPoint)
                withAnimation(Motion.focus) {
                    staged.removeAll { carried.contains($0.token) }
                    for token in tokens { thumbnails[token] = nil }
                    submission = updated
                }
            } catch where error is CancellationError || Task.isCancelled {
                // Stopped, not failed: nothing to say, and the files stay where they are.
            } catch APIError.validation(_, _, let fields) where fields["file_tokens"] != nil {
                // "Token already used": an earlier attempt DID land — its response was lost on
                // the way back. The files are already on the server, so re-read what it holds
                // instead of telling the student the upload failed and inviting a duplicate.
                // The work is in: celebrated now, before the re-read below is awaited (a refresh
                // that lands meanwhile would already hold the payout), and only once.
                celebrations.celebrate(.homework, xpBefore: xpBefore, at: handInSpot.rect.celebrationPoint)
                withAnimation(Motion.focus) {
                    staged.removeAll { carried.contains($0.token) }
                    for token in tokens { thumbnails[token] = nil }
                }
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
            } catch APIError.conflict(let detail) {
                // Changed somewhere else (another device, a teacher's return). Show what the
                // server holds now; the staged files stay, ready to send against it.
                actionError = detail.isEmpty ? "Submission was modified. Refresh and try again." : detail
                sendFailed = true
                submission = (try? await session.student.mySubmission(
                    classroomId: classroomId,
                    assignmentId: a.id
                )) ?? submission
            } catch APIError.http(413, _) {
                // Refused by the proxy before the server saw it; the body is an HTML page.
                actionError = "That upload is too big to send at once. Send fewer files at a time."
                sendFailed = true
            } catch let error as APIError {
                actionError = error.errorDescription
                sendFailed = true
            } catch {
                actionError = error.localizedDescription
                sendFailed = true
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

/// How far each staged file has gone up, by file token — written as URLSession reports the
/// request's body going out, read only by the rows, so the page around them does not re-render
/// with every chunk.
@MainActor
@Observable
final class UploadMeter {
    private(set) var sent: [String: Double] = [:]

    /// The upload's latest numbers, in the order of `tokens`. Only ever forward: a token refresh
    /// sends the body again from zero, and a ring never runs backwards.
    func report(_ fractions: [Double], tokens: [String]) {
        var next = sent
        var moved = false
        for (token, fraction) in zip(tokens, fractions) where fraction > (next[token] ?? 0) {
            next[token] = fraction
            moved = true
        }
        // One write per report, so the rows are told once.
        if moved { sent = next }
    }

    func reset() {
        if !sent.isEmpty { sent = [:] }
    }
}

/// Carries an upload's numbers from the thread URLSession reports on to the main actor.
///
/// URLSession reports in whatever steps it likes — once for a small, fast body, in ~1 MB steps
/// when the network is slow — and never on the main thread. The relay keeps only the newest
/// numbers and asks the main actor for one hop at a time, so a burst of reports is one update;
/// `stop` drops whatever has not been delivered, so a late hop cannot paint a hand-in that has
/// already finished (or failed and been started again).
private final class UploadRelay: Sendable {
    private struct Pending {
        var latest: [Double]?
        var stopped = false
    }

    private let pending = OSAllocatedUnfairLock(initialState: Pending())
    private let deliver: @MainActor @Sendable ([Double]) -> Void

    init(deliver: @escaping @MainActor @Sendable ([Double]) -> Void) {
        self.deliver = deliver
    }

    /// From any thread.
    func report(_ fractions: [Double]) {
        let needsHop = pending.withLock { state -> Bool in
            guard !state.stopped else { return false }
            // A hop is already on its way when numbers are waiting: it will carry these instead.
            let idle = state.latest == nil
            state.latest = fractions
            return idle
        }
        guard needsHop else { return }
        Task { @MainActor [self] in
            let next = pending.withLock { state -> [Double]? in
                let latest = state.latest
                state.latest = nil
                return state.stopped ? nil : latest
            }
            if let next { deliver(next) }
        }
    }

    func stop() {
        pending.withLock { state in
            state.stopped = true
            state.latest = nil
        }
    }
}

/// One file waiting to be handed in: its thumbnail (a photo) or a glyph, its name and size, and a
/// way to take it off — or, while the hand-in is going up, its own progress ring.
struct StagedFileRow: View {
    let file: MultipartForm.File
    let thumbnail: UIImage?
    let meter: UploadMeter
    /// This file is in the request on its way: it shows a ring instead of the remove button.
    let sending: Bool
    let onRemove: @MainActor () -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                preview
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.filename)
                        .font(.system(size: 14, weight: .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(SubmissionLimits.megabytes(file.data.count))
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            // One thing to VoiceOver: the name, then the size — or, while it goes up, how far it has
            // gone, in tens of percent, so a row in focus does not talk through every chunk.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(file.filename)
            .accessibilityValue(
                sending ? UploadRing.spoken(meter.sent[file.token] ?? 0) : SubmissionLimits.megabytes(file.data.count)
            )

            // The same 44 pt slot for both, so the row does not change size when the ring arrives.
            ZStack {
                if sending {
                    UploadRing(fraction: meter.sent[file.token] ?? 0)
                        .transition(.opacity)
                } else {
                    Button(action: onRemove) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Theme.textLabel)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(file.filename)")
                    .transition(.opacity)
                }
            }
            .frame(width: 44, height: 44)
            .animation(Motion.focus, value: sending)
        }
        .cardStyle(padding: 13)
    }

    /// The photo once its thumbnail is made (it fades in over the glyph), else a glyph.
    private var preview: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.accentSoft)
            if let thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                Image(systemName: file.mimeType.hasPrefix("image/") ? "photo" : "doc.fill")
                    .foregroundStyle(Theme.accent)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// One file's real upload progress — its bytes sent over its size — then a tick once all of it
/// has gone. The hand-in itself is confirmed by the server, not by the ticks.
struct UploadRing: View {
    let fraction: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shown: Double { min(max(fraction, 0), 1) }
    private var done: Bool { shown >= 1 }

    var body: some View {
        ZStack {
            Circle().stroke(Theme.surface2, lineWidth: 3)
            Circle()
                .trim(from: 0, to: shown)
                .stroke(Theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if done {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.accent)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .frame(width: 26, height: 26)
        // Each ring moves to the newest number it has been given — reports come in steps, and the
        // ring crosses each one in a beat instead of jumping. The tick rides the same beat.
        .animation(Motion.focus, value: shown)
        // The row says it (`spoken`), once per ten percent.
        .accessibilityHidden(true)
    }

    /// What VoiceOver says of a file going up: stepped in tens, so a row in focus does not
    /// announce every chunk URLSession reports.
    static func spoken(_ fraction: Double) -> String {
        if fraction >= 1 { return "Sent" }
        let tens = Int((max(fraction, 0) * 10).rounded(.down)) * 10
        return "\(tens) percent sent"
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
