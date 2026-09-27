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
///   rail, and drawing nothing would tell the student the school has posted nothing.
///
/// While hidden it is zero points tall.
struct StoriesRail: View {
    var refreshID: Int = 0

    @Environment(Session.self) private var session
    @State private var stories: [Story] = []
    @State private var phase: Phase = .loading
    @State private var loadedAt: Date?
    @State private var loadedForRefresh: Int?
    @State private var opened: StoryViewerItem?

    private enum Phase { case loading, loaded, failed }

    /// Signed image URLs lapse in about an hour; the web treats the rail as fresh for five
    /// minutes, and so does this.
    private static let freshFor: TimeInterval = 5 * 60

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch phase {
            case .loading:
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
        .fullScreenCover(item: $opened) { item in
            StoryViewer(stories: item.stories, startIndex: item.index)
        }
    }

    private var rail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 18) {
                ForEach(Array(stories.enumerated()), id: \.element.id) { index, story in
                    Button {
                        opened = StoryViewerItem(stories: stories, index: index)
                    } label: {
                        StoryCircle(story: story)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(story.title.isEmpty ? "Story" : story.title)
                    .accessibilityHint("Opens the story")
                }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }

    private var failure: some View {
        HStack(spacing: 5) {
            Text("Stories didn't load.")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Button {
                Task { await load() }
            } label: {
                Text("Try again")
                    .font(.system(size: 13, weight: .bold))
                    .underline()
                    .foregroundStyle(Theme.accent)
            }
            .buttonStyle(.plain)
        }
    }

    private func loadIfNeeded() async {
        if phase == .loaded, loadedForRefresh == refreshID,
           let loadedAt, Date().timeIntervalSince(loadedAt) < Self.freshFor {
            return
        }
        await load()
    }

    private func load() async {
        do {
            stories = try await StoriesAPI(client: session.client).rail()
            phase = .loaded
            loadedAt = Date()
            loadedForRefresh = refreshID
        } catch {
            // Leaving the screen cancels the request; that is not a failure to report.
            if Task.isCancelled { return }
            // A re-read that fails keeps the rail it had: the titles are still true.
            if phase != .loaded { phase = .failed }
        }
    }
}

/// One circle: a 66pt gradient ring around the picture (or a blank), the title under it.
private struct StoryCircle: View {
    let story: Story

    var body: some View {
        VStack(spacing: 7) {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Theme.accent, StoryPalette.ringEnd],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 66, height: 66)
                .overlay {
                    picture
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Theme.card, lineWidth: 2))
                        .padding(3)
                }
            Text(story.title)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.primary)
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
