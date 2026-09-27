import SwiftUI
import SafariServices
import MasterSATKit

// Pieces shared by the surveys, events and stories screens. Prefixed `Community` so they
// cannot collide with anything another screen defines.

/// A load that failed: it says so, and offers the retry. Never drawn as "nothing here" — a
/// student told there are no surveys when the request merely failed has lost points.
struct CommunityErrorNotice: View {
    let title: String
    var message: String?
    /// Main-actor on purpose: every caller passes a closure that touches view state.
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 24))
                .foregroundStyle(Theme.warning)
            VStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                if let message {
                    Text(message)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
    }
}

/// A whole-page state — "Survey not available", "Thanks — your answers are in." — as the
/// site's centred card: a tile, a headline, a sentence, and the way out.
struct CommunityStateCard<Actions: View>: View {
    let icon: String
    let title: String
    var message: String?
    var tone: Color = Theme.accent
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(spacing: 14) {
            IconTile(systemName: icon, tone: tone, size: 60)
            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 18, weight: .heavy))
                    .tracking(-0.2)
                if let message {
                    Text(message)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            actions()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .cardStyle(padding: 20)
    }
}

/// Grey placeholder rows while a list loads — the site's skeletons.
struct CommunitySkeletonRows: View {
    var count = 3
    var height: CGFloat = 56

    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Theme.surface2)
                    .frame(height: height)
            }
        }
        .accessibilityLabel("Loading")
    }
}

/// A signed, expiring image URL (the R2 bucket is private). Nothing is cached beyond what
/// `URLCache` does on its own, because the signature lapses in about an hour.
struct CommunityRemoteImage: View {
    let urlString: String
    var contentMode: ContentMode = .fit
    var placeholderHeight: CGFloat = 160
    /// Told once the picture is on screen or has failed — the story viewer holds its clock
    /// until then, so a slow connection does not eat a notice's six seconds.
    var onSettled: (() -> Void)?

    var body: some View {
        AsyncImage(url: URL(string: urlString)) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .onAppear { onSettled?() }
            case .failure:
                placeholder(icon: "photo")
                    .onAppear { onSettled?() }
            default:
                placeholder(icon: nil)
            }
        }
    }

    private func placeholder(icon: String?) -> some View {
        ZStack {
            Rectangle().fill(Theme.surface2)
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.textLabel)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: placeholderHeight)
    }
}

/// Dates and counts, in the site's words.
@MainActor
enum CommunityFormat {
    /// "Sep 3" — the web's `{month: "short", day: "numeric"}`.
    static func dayMonth(_ date: Date) -> String { dayMonthFormatter.string(from: date) }

    /// "Tue, Sep 25 · 15:00" — weekday, day, and the time in the student's own 12/24h style.
    static func when(_ date: Date) -> String {
        "\(weekdayFormatter.string(from: date)) · \(timeFormatter.string(from: date))"
    }

    /// "12 questions", "1 question" — the number written as an identifier, never "1,200".
    static func count(_ n: Int, _ singular: String, _ plural: String) -> String {
        "\(ScoreText.string(n)) \(n == 1 ? singular : plural)"
    }

    private static let dayMonthFormatter = formatter("MMMd")
    private static let weekdayFormatter = formatter("EEEMMMd")
    private static let timeFormatter = formatter("jmm")

    private static func formatter(_ template: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.setLocalizedDateFormatFromTemplate(template)
        return f
    }
}

/// The sentence to show for a failed action.
enum CommunityErrorText {
    static func message(_ error: Error, fallback: String) -> String {
        if let error = error as? APIError {
            switch error {
            case .transport:
                // `errorDescription` is written for logs ("Network error: …").
                return "Couldn't reach MasterSAT. Check your connection and try again."
            case .decoding:
                return fallback
            default:
                return error.errorDescription ?? fallback
            }
        }
        let text = (error as? LocalizedError)?.errorDescription ?? ""
        return text.isEmpty ? fallback : text
    }
}

/// A web page to show in-app, as an identity for `.fullScreenCover(item:)`.
struct CommunityLink: Identifiable, Equatable {
    let url: URL
    var id: String { url.absoluteString }
}

/// `SFSafariViewController` — a story's "Open" link stays inside the app, with Safari's own
/// chrome and none of this app's cookies or tokens.
struct CommunitySafariView: UIViewControllerRepresentable {
    let url: URL
    /// Safari's own Done button dismisses the controller behind SwiftUI's back; this is how
    /// the presenting state hears about it.
    var onFinish: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = UIColor(Theme.accent)
        controller.dismissButtonStyle = .close
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {
        context.coordinator.onFinish = onFinish
    }

    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        var onFinish: () -> Void

        init(onFinish: @escaping () -> Void) {
            self.onFinish = onFinish
        }

        func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
            onFinish()
        }
    }
}

/// The site's text box: a card-coloured field with a hairline border.
struct CommunityFieldChrome: ViewModifier {
    var highlighted = false

    func body(content: Content) -> some View {
        content
            .font(.system(size: 15))
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(highlighted ? Theme.accent : Theme.separator.opacity(0.8), lineWidth: 1)
            )
    }
}

extension View {
    func communityField(highlighted: Bool = false) -> some View {
        modifier(CommunityFieldChrome(highlighted: highlighted))
    }
}
