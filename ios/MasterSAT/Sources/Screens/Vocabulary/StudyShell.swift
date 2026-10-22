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

    /// The site's own blurbs, verbatim — a student who read them on the set page should
    /// find the same promise waiting inside the mode.
    var subtitle: String { VocabPalette.gameBlurb(kitMode) }

    var icon: String { VocabPalette.gameGlyph(kitMode) }

    /// Each mode keeps the colour the web gives it — the one its quarter of every set's bar
    /// is painted in — so the mode a student picked is the mode they land in.
    var tone: Color { VocabPalette.game(kitMode).solid }
}

/// The shell every study mode runs inside — the site's `ModeFrame`.
///
/// The progress rail rides the very top edge, and an empty rail stands in when a mode has
/// no progress to report, so the header never jumps by four points between modes.
///
/// This is also the anti-distraction part, and it is deliberate: no tab bar, no navigation
/// title, no home indicator, and the screen kept awake. The only chrome is a way out and a
/// sense of how far along you are. Everything left is the word.
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
            rail
            header
            Divider()
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.background)
        // Nothing to swipe away to, nothing to peek at.
        .persistentSystemOverlays(.hidden)
        .statusBarHidden(true)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    @ViewBuilder
    private var rail: some View {
        if let progress {
            Bar(fraction: progress, tone: tone, height: 4)
        } else {
            Rectangle().fill(Theme.surface2).frame(height: 4)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: onExit) {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.left").appFont(12, weight: .bold)
                        .accessibilityHidden(true)
                    Text("Back").appFont(13, weight: .bold)
                }
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(Theme.surface2))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)

            VStack(spacing: 1) {
                Text(title)
                    .appFont(13, weight: .heavy)
                    .lineLimit(1)
                Text(subtitle)
                    .appFont(11, weight: .semibold)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)

            if let trailing {
                trailing
            } else {
                // Balances the back pill so the title stays optically centred.
                Color.clear.frame(width: 66, height: 1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Theme.card)
    }
}

/// The pill the modes use for a clock or a counter — the web's `ModePill`.
struct StudyPill: View {
    let text: String
    var icon: String?
    var tone: Color = Theme.textSecondary

    var body: some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).appFont(11, weight: .bold).accessibilityHidden(true) }
            Text(text).appFont(13, weight: .heavy).monospacedDigit()
        }
        .foregroundStyle(tone)
        .lineLimit(1)
        // Speed shows two pills beside the back button and the title, and without this the
        // counter wraps "1/25" onto two lines rather than the row giving up its own space.
        .fixedSize()
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(Capsule().fill(tone.opacity(0.12)))
        .overlay(Capsule().stroke(tone.opacity(0.22), lineWidth: 1))
    }
}

/// mm:ss, the way every clock in the platform is written.
func formatClock(_ seconds: Int) -> String {
    let s = max(0, seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
}

// MARK: - Outcome

struct ModeStat: Identifiable {
    enum Tone { case neutral, success, danger }

    let label: String
    var tone: Tone
    /// A percentage that rolls up from 0 when the end screen appears. When there is one, `value`
    /// is derived from it, so the figure that rolls and the text that is spoken cannot disagree.
    let percent: Int?
    private let text: String

    /// What the stat reads: the percentage's own text when there is one, otherwise the text given.
    var value: String { percent.map { "\(ScoreText.string($0))%" } ?? text }

    var id: String { label }

    init(label: String, value: String, tone: Tone = .neutral) {
        self.label = label
        self.text = value
        self.tone = tone
        self.percent = nil
    }

    private init(label: String, percent: Int, tone: Tone) {
        self.label = label
        self.text = ""
        self.tone = tone
        self.percent = percent
    }

    /// The round's accuracy — the number that rolls up.
    static func accuracy(_ percent: Int, tone: Tone = .neutral) -> ModeStat {
        ModeStat(label: "Accuracy", percent: percent, tone: tone)
    }
}

/// A stat's number: an accuracy rolls up from 0 when the end screen appears (`RollingNumber`).
private struct ModeStatValue: View {
    let stat: ModeStat

    var body: some View {
        if let percent = stat.percent {
            RollingNumber(value: Double(percent), suffix: "%")
        } else {
            Text(stat.value)
        }
    }
}

/// The end-of-round screen every mode lands on — the web's `ModeOutcome`.
///
/// One screen for all four, because a student finishing Speed and a student finishing
/// Matching are in the same place: they want to know how it went and whether to go again —
/// and, now that a game is mastered by one clean run, whether this was that run.
struct ModeOutcomeView: View {
    let mode: StudyMode
    let title: String
    var description: String?
    let stats: [ModeStat]
    /// Nil while the finishing call is still in flight.
    let summary: VocabSessionSummary?
    var errorText: String?
    let isSaving: Bool
    var restartLabel = "Study again"
    let onRestart: @MainActor () -> Void
    let onExit: @MainActor () -> Void
    /// Sends the grading call again after it failed; the answers were kept.
    var onRetrySave: (@MainActor () -> Void)?
    /// Extra content between the stats and the actions — the test's review list.
    var extra: AnyView?

    @State private var trophyPopped = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A good outcome by the one rule (`CelebrationRule.vocabRound`): the server says this round
    /// mastered its game. Not the mode's own belief that it was clean (it fired before the round
    /// was graded), and not a set mastered by earlier rounds while this one was not clean. The
    /// hand-in itself is celebrated every time once the cover has gone — this is the outcome on
    /// top of it, never a second effort party.
    private var partying: Bool { CelebrationRule.vocabRound(summary) }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                statGrid
                statusLine
                if let extra { extra }

                VStack(spacing: 10) {
                    Button(action: onRestart) {
                        Label(restartLabel, systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle(tone: mode.tone, fullWidth: true))
                    .disabled(isSaving)

                    Button("Back to vocabulary", action: onExit)
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                }
                .padding(.top, 4)
            }
            .padding(18)
        }
        .background(Theme.background)
        .overlay {
            if partying { VocabCelebration() }
        }
        .onAppear {
            // The trophy is chrome on the hero and never covers the stats, so it may spring.
            // Under Reduce Motion it stays at rest.
            guard partying, !reduceMotion else { return }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.5).delay(0.15)) { trophyPopped = true }
        }
        .onChange(of: partying) { _, now in
            if now, !reduceMotion { withAnimation(.spring(response: 0.45, dampingFraction: 0.5)) { trophyPopped = true } }
        }
    }

    private var hero: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.white.opacity(0.16))
                .frame(width: 64, height: 64)
                .overlay(
                    Image(systemName: "trophy.fill")
                        .appFont(28)
                        .capDynamicType()
                        .foregroundStyle(.white)
                        .scaleEffect(trophyPopped ? 1.12 : 1)
                        .rotationEffect(.degrees(trophyPopped ? -8 : 0))
                        .accessibilityHidden(true)
                )
            Text(title)
                .appFont(27, weight: .heavy)
                .tracking(-0.7)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.top, 16)
            if let description {
                Text(description)
                    .appFont(14, weight: .medium)
                    .foregroundStyle(.white.opacity(0.82))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [Theme.accent, Theme.accentHover],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .background(Theme.accent)
        .overlay(alignment: .topTrailing) {
            Circle().fill(.white.opacity(0.07))
                .frame(width: 200, height: 200)
                .offset(x: 50, y: -70)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
    }

    private var statGrid: some View {
        HStack(spacing: 10) {
            ForEach(stats) { stat in
                VStack(spacing: 6) {
                    ModeStatValue(stat: stat)
                        .appFont(25, weight: .heavy).monospacedDigit()
                        .tracking(-0.6)
                        .foregroundStyle(colour(stat.tone))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(stat.label.uppercased())
                        .appFont(10, weight: .heavy)
                        .tracking(0.6)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .padding(.horizontal, 8)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .fill(fill(stat.tone))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(border(stat.tone), lineWidth: 1)
                )
            }
        }
    }

    @ViewBuilder
    private var statusLine: some View {
        if isSaving {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Saving your progress…")
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(Theme.textSecondary)
            }
        } else if let errorText {
            // Named rather than swallowed: a run that did not save is a run the student
            // will otherwise think they banked.
            VStack(spacing: 8) {
                Text(errorText)
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(Theme.danger)
                    .multilineTextAlignment(.center)
                if let onRetrySave {
                    Button(action: onRetrySave) {
                        Label("Retry save", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        } else if let summary {
            let tally = "\(ScoreText.string(summary.mastery.masteredModes))/\(ScoreText.string(summary.mastery.totalModes))"
            if summary.mastery.isMastered {
                Chip(text: "Set mastered — all four games", icon: "sparkles", tone: .success)
            } else if summary.modeMastered {
                Chip(text: "Game mastered · \(tally)", icon: "sparkles", tone: .success)
            } else {
                // Not mastered is not a failure, and it is not silence either: the student
                // should leave knowing exactly what the clean run they need looks like.
                let so = Text(verbatim: tally).fontWeight(.bold).foregroundStyle(Color.primary)
                Text("Every word right in one round masters this game — \(so) so far.")
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func colour(_ tone: ModeStat.Tone) -> Color {
        switch tone {
        case .neutral: return .primary
        case .success: return Theme.success
        case .danger: return Theme.danger
        }
    }

    private func fill(_ tone: ModeStat.Tone) -> Color {
        switch tone {
        case .neutral: return Theme.card
        case .success: return Theme.successSoft
        case .danger: return Theme.dangerSoft
        }
    }

    private func border(_ tone: ModeStat.Tone) -> Color {
        switch tone {
        case .neutral: return Theme.separator.opacity(0.5)
        case .success: return Theme.success.opacity(0.25)
        case .danger: return Theme.danger.opacity(0.25)
        }
    }
}
