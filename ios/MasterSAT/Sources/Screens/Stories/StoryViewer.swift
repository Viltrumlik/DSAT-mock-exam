import SwiftUI
import MasterSATKit

/// A story, full-screen — the web's `StoryViewer`.
///
/// - The picture gets the whole screen and is FITTED, never cropped: these are posters with
///   dates on them.
/// - It moves on by itself every 6 seconds; tapping the left third goes back, the right
///   two-thirds forward; holding pauses. Past the last story it closes. Swiping down closes.
/// - The clock waits for the picture to arrive, and stops while the app is in the background
///   or VoiceOver is running — six seconds is not long enough to hear a caption read out.
/// - "Open" either routes anywhere on this site (`onRoute`, and the viewer closes — the app's
///   own screen when there is one, else the website through the router) or hands an off-site
///   page to the system browser, where the student's web session lives and the viewer stays.
/// - The caption band is capped at half the screen and scrolls past that, so a long notice at
///   the accessibility sizes cannot push "Open" off the bottom.
struct StoryViewer: View {
    let stories: [Story]
    /// Asked for a screen inside the app. The rail moves the router once this cover has gone:
    /// a push made while a full-screen cover is still dismissing is dropped.
    let onRoute: (AppLink) -> Void

    @State private var index: Int
    @State private var progress: Double = 0
    @State private var holding = false
    @State private var pressStart: Date?
    @State private var imageSettled: Bool
    @State private var dragOffset: CGFloat = 0

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private static let duration: TimeInterval = 6

    init(stories: [Story], startIndex: Int, onRoute: @escaping (AppLink) -> Void = { _ in }) {
        self.stories = stories
        self.onRoute = onRoute
        let start = min(max(startIndex, 0), max(stories.count - 1, 0))
        _index = State(initialValue: start)
        _imageSettled = State(initialValue: stories.indices.contains(start) ? stories[start].imageURL == nil : true)
    }

    private var story: Story? { stories.indices.contains(index) ? stories[index] : nil }

    /// The clock runs only while the student can actually be looking at it.
    private var paused: Bool {
        holding || voiceOver || !imageSettled || scenePhase != .active
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let story {
                // The screen's own height, so the caption band can be capped against it: the
                // picture is a `GeometryReader` with no intrinsic height of its own, and a
                // caption left to grow freely at AX5 squeezes it to nothing and then runs the
                // "Open" button off the bottom.
                GeometryReader { screen in
                    VStack(spacing: 0) {
                        picture(story)
                        caption(story, maxHeight: screen.size.height / 2)
                    }
                }
                .overlay(alignment: .top) { chrome }
                .offset(y: dragOffset)
            }
        }
        .statusBarHidden()
        .task(id: index) { await run() }
    }

    // MARK: - The clock

    private func run() async {
        progress = 0
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(50))
            if Task.isCancelled { return }
            if paused { continue }
            progress = min(progress + 0.05 / Self.duration, 1)
            if progress >= 1 {
                go(index + 1)
                return
            }
        }
    }

    private func go(_ next: Int) {
        guard next >= 0 else { return }
        // Past the last story closes the viewer, the way a story set ends everywhere else.
        guard next < stories.count else {
            dismiss()
            return
        }
        imageSettled = stories[next].imageURL == nil
        index = next
    }

    // MARK: - The picture and its tap zones

    private func picture(_ story: Story) -> some View {
        GeometryReader { geometry in
            ZStack {
                if let url = story.imageURL.flatMap(URL.init(string:)) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .onAppear { imageSettled = true }
                        case .failure:
                            VStack(spacing: 10) {
                                Image(systemName: "photo")
                                    .appFont(28)
                                    .accessibilityHidden(true)
                                Text(story.title)
                                    .appFont(20, weight: .heavy)
                                    .multilineTextAlignment(.center)
                            }
                            .foregroundStyle(.white.opacity(0.75))
                            .padding(32)
                            .onAppear { imageSettled = true }
                        default:
                            ProgressView().tint(.white)
                        }
                    }
                    .id(story.id)
                } else {
                    Text(story.title)
                        .appFont(22, weight: .heavy)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(32)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .contentShape(Rectangle())
            .gesture(press(width: geometry.size.width))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Story \(index + 1) of \(stories.count)" + (story.title.isEmpty ? "" : ": \(story.title)")
        )
        .accessibilityAddTraits(.isImage)
        .accessibilityAction(named: "Next story") { go(index + 1) }
        .accessibilityAction(named: "Previous story") { go(index - 1) }
    }

    /// One gesture for all three meanings of a touch: a quick tap moves (left third back,
    /// the rest forward), a hold pauses for as long as it lasts, a pull down closes.
    private func press(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if pressStart == nil {
                    pressStart = Date()
                    holding = true
                }
                let dy = value.translation.height
                if dy > 0, abs(dy) > abs(value.translation.width) { dragOffset = dy }
            }
            .onEnded { value in
                let held = pressStart.map { Date().timeIntervalSince($0) } ?? 0
                pressStart = nil
                holding = false
                if value.translation.height > 120 {
                    dismiss()
                    return
                }
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { dragOffset = 0 }
                let moved = hypot(value.translation.width, value.translation.height)
                // A hold or a drag is not a tap.
                guard held < 0.35, moved < 10 else { return }
                if value.startLocation.x < width / 3 {
                    go(index - 1)
                } else {
                    go(index + 1)
                }
            }
    }

    // MARK: - Chrome

    /// One bar per story, the current one filling as it plays, and the ×.
    private var chrome: some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 4) {
                ForEach(stories.indices, id: \.self) { position in
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.32))
                            Capsule()
                                .fill(.white)
                                .frame(width: geometry.size.width * fill(position))
                        }
                    }
                    .frame(height: 3)
                }
            }
            // Taps on the bars belong to the zones underneath.
            .allowsHitTesting(false)
            .accessibilityHidden(true)

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .appFont(22, weight: .semibold)
                    .foregroundStyle(.white)
                    .padding(10)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            // Chrome, not content: the × holds its size while the caption below grows.
            .capDynamicType(label: "Close", systemImage: "xmark")
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
    }

    private func fill(_ position: Int) -> CGFloat {
        if position < index { return 1 }
        if position == index { return CGFloat(progress) }
        return 0
    }

    // MARK: - Caption

    /// Its own band under the picture rather than laid over it: these are school notices, and
    /// text over an arbitrary photograph is a contrast gamble some of them would lose.
    ///
    /// The band sizes itself to its words and stops at `maxHeight` (half the screen), past
    /// which it scrolls in place. The website's picture is `flex: 1; min-height: 0` in a
    /// `100dvh` column and the page itself scrolls; here nothing scrolls, so a long notice at
    /// the accessibility sizes would otherwise take the "Open" button off the bottom of the
    /// device with it.
    @ViewBuilder private func caption(_ story: Story, maxHeight: CGFloat) -> some View {
        let routed = story.routedLink
        let url = story.openableLink
        if !story.title.isEmpty || !story.caption.isEmpty || routed != nil || url != nil {
            ScrollView {
                VStack(spacing: 5) {
                    if !story.title.isEmpty {
                        Text(story.title)
                            .appFont(17, weight: .heavy)
                            .foregroundStyle(.white)
                    }
                    if !story.caption.isEmpty {
                        Text(story.caption)
                            .appFont(14, weight: .medium)
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    if routed != nil || url != nil {
                        // A place on the site is routed to, closing the viewer, so the student
                        // lands on it signed in — on its own screen when the app has one, else
                        // on the website through the router's `.web` branch. Anything else goes
                        // to the system browser, which carries their web session — the in-app
                        // Safari sheet this replaces was signed out, and an "Open" that lands on
                        // a sign-in form is the bug.
                        Button {
                            if let routed {
                                onRoute(routed)
                                dismiss()
                            } else if let url {
                                // Off-site: deliberately NOT a dismiss. It matches the website's
                                // `target="_blank"` — the story is still there when the student
                                // comes back from the browser.
                                openURL(url)
                            }
                        } label: {
                            Text("Open")
                                .appFont(14, weight: .heavy)
                                .foregroundStyle(Color(white: 0.07))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 9)
                                .frame(minHeight: 44)
                                .background(Capsule().fill(.white))
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 7)
                        .accessibilityLabel(openLabel(story, routed: routed))
                    }
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 18)
                .padding(.top, 14)
                .padding(.bottom, 18)
            }
            .scrollBounceBehavior(.basedOnSize)
            // Together: the band asks for the height its words need (`fixedSize`, so it never
            // takes the picture's space the way a plain `ScrollView` would) and is clamped to
            // half the screen, past which it scrolls.
            .frame(maxHeight: max(maxHeight, 0))
            .fixedSize(horizontal: false, vertical: true)
            .background(
                LinearGradient(
                    colors: [.black.opacity(0.92), .black.opacity(0)],
                    startPoint: .bottom,
                    endPoint: .top
                )
            )
        }
    }

    /// "Open" alone says nothing about where it goes; VoiceOver gets the destination.
    private func openLabel(_ story: Story, routed: AppLink?) -> String {
        if routed != nil {
            return story.title.isEmpty ? "Open this story's page" : "Open \(story.title)"
        }
        return story.title.isEmpty
            ? "Open in the browser"
            : "Open \(story.title) in the browser"
    }
}
