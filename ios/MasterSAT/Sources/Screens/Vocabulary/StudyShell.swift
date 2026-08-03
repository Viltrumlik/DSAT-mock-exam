import SwiftUI
import MasterSATKit

/// The four study modes the platform defines. All of them ship on the phone.
enum StudyMode: String, CaseIterable, Identifiable {
    case flashcard
    case matching
    case speed
    case test

    var id: String { rawValue }

    var kitMode: VocabStudyMode {
        switch self {
        case .flashcard: return .flashcard
        case .matching: return .matching
        case .speed: return .speed
        case .test: return .test
        }
    }

    var title: String {
        switch self {
        case .flashcard: return "Flashcards"
        case .matching: return "Matching"
        case .speed: return "Speed"
        case .test: return "Test"
        }
    }

    var subtitle: String {
        switch self {
        case .flashcard: return "See the word, recall the meaning. Missed words come back."
        case .matching: return "Pair every word with its definition. Beat your own clock."
        case .speed: return "Sixty seconds. Pick the right definition, fast."
        case .test: return "Pick the right definition. One pass, then a score."
        }
    }

    var icon: String {
        switch self {
        case .flashcard: return "rectangle.on.rectangle"
        case .matching: return "square.grid.2x2"
        case .speed: return "bolt.fill"
        case .test: return "checkmark.circle"
        }
    }

    /// Each mode keeps the accent the web gives it, so the mode a student picked is the
    /// mode they land in.
    var tone: Color {
        switch self {
        case .flashcard: return Theme.accent
        case .matching: return Theme.info
        case .speed: return Theme.warning
        case .test: return Theme.success
        }
    }

    /// The smallest set the mode is worth running on.
    var minimumWords: Int {
        switch self {
        case .flashcard: return 1
        case .matching: return 2
        case .speed, .test: return 4
        }
    }
}

/// The shell every study mode runs inside.
///
/// This is the anti-distraction part, and it is deliberate: a plain full-screen surface,
/// no tab bar, no navigation title, no home indicator, and the screen kept awake. The only
/// chrome is a way out and a sense of how far along you are. Everything left is the word.
struct StudyShell<Content: View>: View {
    let title: String
    let subtitle: String
    let tone: Color
    var progress: Double?
    var trailing: AnyView?
    let onExit: @MainActor () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            header
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.examBackground)
        // Nothing to swipe away to, nothing to peek at.
        .persistentSystemOverlays(.hidden)
        .statusBarHidden(true)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Button(action: onExit) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Theme.surface2))
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 15, weight: .bold))
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if let trailing { trailing }
            }
            if let progress {
                Bar(fraction: progress, tone: tone, height: 4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }
}

/// The pill the modes use for a clock or a counter — the web's `ModePill`.
struct StudyPill: View {
    let text: String
    var icon: String?
    var tone: Color = Theme.textSecondary

    var body: some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 11, weight: .bold)) }
            Text(text).font(.system(size: 13, weight: .bold).monospacedDigit())
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(Capsule().fill(tone.opacity(0.12)))
    }
}

/// mm:ss, the way every clock in the platform is written.
func formatClock(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
}
