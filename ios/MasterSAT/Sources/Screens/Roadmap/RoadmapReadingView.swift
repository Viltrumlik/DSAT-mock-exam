import SwiftUI
import AVKit
import MasterSATKit

/// The reading that comes before a lesson's homework — the site's `/roadmap/{deliveryId}`.
///
/// Top to bottom: the lesson's hero, its sections (passages, pictures, videos), and at the
/// bottom the one thing the page is for — confirm the reading, then open the homework. In that
/// order, because the homework is what the reading was for.
///
/// The homework id is withheld by the server until the homework is released AND the reading
/// is confirmed (when the author asked for that), so the button appears only once there is
/// genuinely something to open.
struct RoadmapReadingView: View {
    let deliveryId: Int

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var reading: RoadmapReading?
    @State private var failure: Failure?
    @State private var isMarking = false
    @State private var markFailed = false
    @State private var isOpeningHomework = false
    @State private var homeworkError: String?
    @State private var homework: RoadmapHomeworkTarget?

    private enum Failure: Equatable {
        /// 404: not one of the student's lessons, or not reached their class yet.
        case notFound
        case other(String)
    }

    private var api: RoadmapAPI { RoadmapAPI(client: session.client) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                backLink
                content
            }
            .padding(16)
            .padding(.bottom, 24)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { if reading == nil { await load() } }
        .refreshable { await load() }
        .navigationDestination(item: $homework) { target in
            HomeworkDetailView(assignment: target.assignment)
        }
    }

    private var backLink: some View {
        Button {
            dismiss()
        } label: {
            Label("Back to the roadmap", systemImage: "arrow.left")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - The four states

    @ViewBuilder
    private var content: some View {
        if deliveryId <= 0 {
            // Not a request that can succeed, so not a spinner that never ends.
            LearnMoreEmptyCard(
                icon: "book.pages",
                title: "That isn’t a lesson link",
                message: "The address is missing a lesson number."
            ) { backButton }
        } else if let reading {
            loaded(reading)
        } else if let failure {
            switch failure {
            case .notFound:
                LearnMoreEmptyCard(
                    icon: "book.pages",
                    title: "Nothing to read here",
                    message: "This lesson isn’t one of yours, or it hasn’t reached your class yet."
                ) { backButton }
            case .other(let detail):
                // A dropped request is not "no reading": saying so would send a student away
                // from a page that is sitting there perfectly fine.
                LearnMoreErrorCard(
                    title: "That didn’t load",
                    message: "Nothing has been lost — the reading just couldn’t be fetched.\n\(detail)"
                ) { await load() }
            }
        } else {
            VStack(spacing: 16) {
                LearnMoreSkeleton(height: 160)
                LearnMoreSkeleton(height: 240)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading the reading")
        }
    }

    private var backButton: some View {
        Button("Back to the roadmap") { dismiss() }
            .buttonStyle(SecondaryButtonStyle())
    }

    @ViewBuilder
    private func loaded(_ reading: RoadmapReading) -> some View {
        HeroHeader(
            eyebrow: "Lesson \(reading.lessonNumber)",
            eyebrowIcon: "book.pages",
            title: reading.title,
            blurb: reading.summary.isEmpty ? nil : reading.summary,
            tiles: reading.estimatedMinutes > 0
                ? [HeroTile("Reading time", icon: "clock", value: "\(reading.estimatedMinutes) min")]
                : []
        )

        if reading.sections.isEmpty {
            LearnMoreEmptyCard(
                icon: "book.pages",
                title: "Nothing written for this lesson yet",
                message: "Your teacher hasn’t added the reading for it. The homework is below if it has been set."
            )
        } else {
            ForEach(reading.sections) { section in
                RoadmapSectionCard(section: section) { await load() }
            }
        }

        if markFailed {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(Theme.danger)
                VStack(alignment: .leading, spacing: 2) {
                    Text("That didn’t save").font(.system(size: 14, weight: .bold))
                    Text("Your place wasn’t recorded — try the button again.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.dangerSoft))
        }

        bottom(reading)
    }

    // MARK: - The bottom: confirm, then the homework

    private func bottom(_ reading: RoadmapReading) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if reading.read {
                Label("You’ve read this", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.success)
            } else if reading.requireReadConfirmation {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Finished reading?")
                        .font(.system(size: 15, weight: .bold))
                    Text("Press the button and your homework for this lesson opens underneath.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    Task { await markRead() }
                } label: {
                    HStack(spacing: 8) {
                        if isMarking {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        Text("I’ve finished reading")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(isMarking)
            }

            if let assignmentId = reading.homeworkAssignmentId {
                Button {
                    Task { await openHomework(assignmentId) }
                } label: {
                    HStack(spacing: 8) {
                        if isOpeningHomework {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "doc.text.fill")
                        }
                        Text("Open the homework")
                        Image(systemName: "arrow.right")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(isOpeningHomework)

                if let homeworkError {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("That didn’t open").font(.system(size: 13, weight: .bold))
                        Text(homeworkError)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(Theme.danger)
                }
            } else if reading.read || !reading.requireReadConfirmation {
                // Read, and still nothing to open. Say which of the two reasons it is:
                // "not released yet" and "not confirmed" are different situations, and only
                // one of them is the student's to fix.
                Text(
                    reading.homeworkReleased
                        ? "The homework for this lesson isn’t available right now."
                        : "No homework has been set for this lesson yet."
                )
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .cardStyle(padding: 18)
    }

    // MARK: - Requests

    @MainActor
    private func load() async {
        guard deliveryId > 0 else { return }
        do {
            reading = try await api.reading(deliveryId: deliveryId)
            failure = nil
        } catch {
            if Task.isCancelled { return }
            // A failed refresh over a page already on screen keeps the page.
            guard reading == nil else { return }
            if case APIError.http(let status, _) = error, status == 404 {
                failure = .notFound
            } else {
                failure = .other(learnMoreMessage(error))
            }
        }
    }

    /// "I've finished reading". One press, one request: the button is disabled while it is in
    /// flight and a failure is said, never retried behind the student's back.
    @MainActor
    private func markRead() async {
        guard !isMarking else { return }
        isMarking = true
        markFailed = false
        defer { isMarking = false }
        do {
            // The response IS the new page — the homework id arrives with it.
            let updated = try await api.markRead(deliveryId: deliveryId)
            withAnimation(.easeOut(duration: 0.2)) { reading = updated }
        } catch {
            markFailed = true
        }
    }

    @MainActor
    private func openHomework(_ assignmentId: Int) async {
        guard !isOpeningHomework else { return }
        isOpeningHomework = true
        homeworkError = nil
        defer { isOpeningHomework = false }
        do {
            let listing = try await RoadmapHomework.listing(assignmentId: assignmentId, student: session.student)
            homework = RoadmapHomeworkTarget(assignment: listing)
        } catch {
            if Task.isCancelled { return }
            homeworkError = learnMoreMessage(error)
        }
    }
}

// MARK: - A section

/// One block of the reading, in its own card: a passage, a picture, or a video.
struct RoadmapSectionCard: View {
    let section: RoadmapSection
    /// Signed picture and video addresses expire after about an hour; reloading the reading
    /// fetches fresh ones.
    let reload: @MainActor () async -> Void

    var body: some View {
        if section.kind != nil {
            VStack(alignment: .leading, spacing: 10) {
                if !section.heading.isEmpty {
                    Text(verbatim: section.heading)
                        .font(.system(size: 17, weight: .heavy))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                switch section.kind {
                case .text:
                    passage
                case .image:
                    if let raw = section.imageURL, let url = URL(string: raw) {
                        RoadmapSectionImage(url: url, caption: section.caption, reload: reload)
                    }
                case .video:
                    if let link = RoadmapVideoLink(section.videoURL) {
                        RoadmapSectionVideo(link: link)
                    }
                case nil:
                    EmptyView()
                }
            }
            .cardStyle(padding: 18)
        }
    }

    /// Plain text: blank lines separate paragraphs, and nothing else is interpreted.
    private var passage: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(verbatim: paragraph)
                    .font(.system(size: 15.5))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
    }
}

/// A section's picture, with the line under it.
struct RoadmapSectionImage: View {
    let url: URL
    let caption: String
    let reload: @MainActor () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(caption.isEmpty ? "Picture" : caption)
                case .failure:
                    VStack(spacing: 10) {
                        Image(systemName: "photo")
                            .font(.system(size: 22))
                            .foregroundStyle(Theme.textLabel)
                        Text("The picture didn’t load.")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                        Button("Try again") { Task { await reload() } }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                default:
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .frame(height: 180)
                }
            }
            .background(Theme.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )

            if !caption.isEmpty {
                Text(verbatim: caption)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A section's video: an uploaded file plays right here; a YouTube or Vimeo link opens in its
/// own app, on a card that says where it goes.
struct RoadmapSectionVideo: View {
    let link: RoadmapVideoLink

    @State private var player: AVPlayer?

    var body: some View {
        switch link {
        case .file(let url):
            ZStack {
                Color.black
                if let player {
                    VideoPlayer(player: player)
                }
            }
            .frame(height: 210)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            // Held in state, not built in `body`: a player made per render restarts the video
            // every time anything on the page changes.
            .onAppear { if player == nil { player = AVPlayer(url: url) } }
            .onDisappear { player?.pause() }
        case .external(let url):
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
                        Text(url.host ?? url.absoluteString)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textLabel)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.background))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
                )
            }
            .accessibilityHint("Opens outside the app")
        }
    }
}
