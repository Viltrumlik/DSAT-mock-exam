import SwiftUI
import MasterSATKit

/// A story, full-screen — the web's `StoryViewer`.
///
/// - The picture gets the whole screen and is FITTED, never cropped: these are posters with
///   dates on them.
/// - It moves on by itself every 6 seconds; tapping the left third goes back, the right
///   two-thirds forward; holding pauses. Past the last story it closes. Swiping down closes.
/// - The clock waits for the picture to arrive, and stops while "Open" is showing a page or
///   VoiceOver is running — six seconds is not long enough to hear a caption read out.
struct StoryViewer: View {
    let stories: [Story]

    @State private var index: Int
    @State private var progress: Double = 0
    @State private var holding = false
    @State private var pressStart: Date?
    @State private var imageSettled: Bool
    @State private var link: CommunityLink?
    @State private var dragOffset: CGFloat = 0

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private static let duration: TimeInterval = 6

    init(stories: [Story], startIndex: Int) {
        self.stories = stories
        let start = min(max(startIndex, 0), max(stories.count - 1, 0))
        _index = State(initialValue: start)
        _imageSettled = State(initialValue: stories.indices.contains(start) ? stories[start].imageURL == nil : true)
    }

    private var story: Story? { stories.indices.contains(index) ? stories[index] : nil }

    /// The clock runs only while the student can actually be looking at it.
    private var paused: Bool {
        holding || link != nil || voiceOver || !imageSettled || scenePhase != .active
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let story {
                VStack(spacing: 0) {
                    picture(story)
                    caption(story)
                }
                .overlay(alignment: .top) { chrome }
                .offset(y: dragOffset)
            }
        }
        .statusBarHidden()
        .task(id: index) { await run() }
        .fullScreenCover(item: $link) { page in
            CommunitySafariView(url: page.url) { link = nil }
                .ignoresSafeArea()
        }
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
                                    .font(.system(size: 28))
                                Text(story.title)
                                    .font(.system(size: 20, weight: .heavy))
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
                        .font(.system(size: 22, weight: .heavy))
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
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(10)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
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
    @ViewBuilder private func caption(_ story: Story) -> some View {
        let url = story.openableLink
        if !story.title.isEmpty || !story.caption.isEmpty || url != nil {
            VStack(spacing: 5) {
                if !story.title.isEmpty {
                    Text(story.title)
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(.white)
                }
                if !story.caption.isEmpty {
                    Text(story.caption)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(8)
                }
                if let url {
                    // In-app Safari: the page opens over the story instead of taking the
                    // student out of the app, and the story waits while it is open.
                    Button {
                        link = CommunityLink(url: url)
                    } label: {
                        Text("Open")
                            .font(.system(size: 14, weight: .heavy))
                            .foregroundStyle(Color(white: 0.07))
                            .padding(.horizontal, 20)
                            .padding(.vertical, 9)
                            .background(Capsule().fill(.white))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 7)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 18)
            .background(
                LinearGradient(
                    colors: [.black.opacity(0.92), .black.opacity(0)],
                    startPoint: .bottom,
                    endPoint: .top
                )
            )
        }
    }
}
