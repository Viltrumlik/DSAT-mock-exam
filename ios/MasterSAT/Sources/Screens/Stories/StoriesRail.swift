import SwiftUI
import MasterSATKit

/// The ring of circles across the top of Home — the web's `DashboardStories`.
///
/// Mount as `StoriesRail()` (pass `refreshID:` a counter bumped by Home's pull-to-refresh to
/// reload it). It hides itself when there is nothing to show, and ONLY then:
///
/// - loading: nothing — not a row of placeholder circles. The rail is optional furniture,
///   and a placeholder that usually resolves to nothing makes every Home load look like it
///   is about to show something;
/// - empty: nothing — a school with no stories posted should not get a band of grey circles;
/// - failed: one quiet line, "Stories didn't load. Try again". A failed fetch is not an empty
///   rail, and drawing nothing would tell the student the school has posted nothing. A payload
///   the app cannot read counts as a failure, not as a school with nothing to say.
///
/// While hidden it is zero points tall. A cancelled load (the student left the screen mid-
/// request) is neither a failure nor an answer, so it is not drawn as one: the rail goes back
/// to `.idle`. What asks again is `.task(id: refreshID)` — Today bumps `refreshTick` on every
/// return to the tab and on pull-to-refresh (`TodayView.onAppear`), and the task re-runs on
/// each appearance besides. Nothing else re-triggers the rail: the eager `SlotStack` inside the
/// `TabView` is never torn down.
struct StoriesRail: View {
    var refreshID: Int = 0
    /// Drawn inside Today's blue band (the new look): white rings and white captions, so the
    /// circles read on blue.
    var onBand = false

    @Environment(Session.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(CelebrationCenter.self) private var celebrations
    @State private var stories: [Story] = []
    @State private var phase: Phase = .idle
    @State private var loadedAt: Date?
    @State private var loadedForRefresh: Int?
    @State private var opened: StoryViewerItem?
    @State private var pendingLink: AppLink?

    private enum Phase { case idle, loading, loaded, failed }

    /// Signed image URLs lapse in about an hour; the web treats the rail as fresh for five
    /// minutes, and so does this.
    private static let freshFor: TimeInterval = 5 * 60

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch phase {
            case .idle, .loading:
                Color.clear.frame(height: 0)
            case .failed:
                failure
            case .loaded:
                if stories.isEmpty {
                    Color.clear.frame(height: 0)
                } else {
                    rail
                }
            }
        }
        // Runs on every appearance; `loadIfNeeded` decides whether that is worth a request.
        .task(id: refreshID) { await loadIfNeeded() }
        .fullScreenCover(item: $opened, onDismiss: routeIfAsked) { item in
            StoryViewer(stories: item.stories, startIndex: item.index) { pendingLink = $0 }
                .coversCelebrations(celebrations)
                .noBarClearance()
        }
    }

    /// A story's "Open" asked for a screen in the app. The move happens here, once the cover
    /// has gone: a tab switch and a push made while a full-screen cover is still dismissing
    /// are dropped on the way.
    private func routeIfAsked() {
        guard let link = pendingLink else { return }
        pendingLink = nil
        router.open(link, baseURL: session.client.config.baseURL) { openURL($0) }
    }

    private var rail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 18) {
                ForEach(Array(stories.enumerated()), id: \.element.id) { index, story in
                    Button {
                        opened = StoryViewerItem(stories: stories, index: index)
                    } label: {
                        StoryCircle(story: story, onBand: onBand)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(story.title.isEmpty ? "Story" : story.title)
                    .accessibilityHint("Opens the story")
                }
            }
            .padding(.vertical, 2)
            // On the band the rail runs to the screen's edges and starts at the page's margin.
            .padding(.horizontal, onBand ? 16 : 0)
        }
        .scrollIndicators(.hidden)
        .noBarClearanceInRow()
    }

    private var failure: some View {
        HStack(spacing: 5) {
            Text("Stories didn't load.")
                .appFont(13, weight: .semibold)
                .foregroundStyle(onBand ? Color.white.opacity(0.8) : Theme.textSecondary)
            Button {
                Task { await load() }
            } label: {
                Text("Try again")
                    .appFont(13, weight: .bold)
                    .underline()
                    .foregroundStyle(onBand ? Color.white : Theme.accent)
                    // 13-pt underlined text is a 16-pt target; this is the rail's only
                    // control, and the row is already its own line.
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, onBand ? 16 : 0)
    }

    private func loadIfNeeded() async {
        if phase == .loaded, loadedForRefresh == refreshID,
           let loadedAt, Date().timeIntervalSince(loadedAt) < Self.freshFor {
            return
        }
        await load()
    }

    private func load() async {
        if phase == .idle { phase = .loading }
        do {
            stories = try await StoriesAPI(client: session.client).rail()
            phase = .loaded
            loadedAt = Date()
            loadedForRefresh = refreshID
        } catch {
            // Leaving the screen cancels the request; that is not a failure to report. A
            // first load that was cancelled goes back to `.idle`, so the state says "not
            // asked yet" rather than "asking"; the next bump of `refreshID`, or the next
            // appearance, asks again either way.
            if Task.isCancelled {
                if phase == .loading { phase = .idle }
                return
            }
            // A re-read that fails keeps the rail it had: the titles are still true.
            if phase != .loaded { phase = .failed }
        }
    }
}

/// One circle: a 66pt gradient ring around the picture (or a blank), the title under it.
private struct StoryCircle: View {
    let story: Story
    var onBand = false

    /// Off the band: the web's blue → pink ring. On it: a white ring with the band's blue showing
    /// through a 3-pt gap (the kit's story circles on the band).
    private var ring: AnyShapeStyle {
        onBand
            ? AnyShapeStyle(Color.white)
            : AnyShapeStyle(LinearGradient(
                colors: [Theme.accent, StoryPalette.ringEnd],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
    }

    var body: some View {
        VStack(spacing: 7) {
            Circle()
                .fill(ring)
                .frame(width: 66, height: 66)
                .overlay {
                    picture
                        .clipShape(Circle())
                        .overlay(Circle().stroke(onBand ? ClassTabPalette.band : Theme.card, lineWidth: onBand ? 3 : 2))
                        .padding(onBand ? 2.5 : 3)
                }
            Text(story.title)
                .appFont(11, weight: .bold)
                // A rail of 78-pt cells: the caption cannot outgrow its cell.
                .capDynamicType()
                .foregroundStyle(onBand ? Color.white : Color.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 78)
        }
        .frame(width: 78)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var picture: some View {
        if let url = story.imageURL.flatMap(URL.init(string:)) {
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Theme.surface2
                }
            }
        } else {
            // Saved without a picture, which the Django admin allows: a blank circle, not a
            // broken rail.
            Theme.surface2
        }
    }
}

/// Which story the viewer opens on.
private struct StoryViewerItem: Identifiable {
    let stories: [Story]
    let index: Int

    var id: Int { stories[index].id }
}

enum StoryPalette {
    /// The ring's far end: the web's literal `#e0559a` (DashboardStories.tsx). It is the
    /// one colour here that is not a Theme token — the rail uses it nowhere else either.
    static let ringEnd = Color(red: 224 / 255, green: 85 / 255, blue: 154 / 255)
}
