import SwiftUI
import MasterSATKit

/// Speed — sixty seconds, one word at a time, two definitions to choose between.
///
/// A tap advances instantly: no confirm step, no feedback pause. The whole point is
/// recognition under time pressure, and a "correct!" flash between words would defeat it.
struct SpeedView: View {
    @Bindable var runner: VocabStudyRunner
    let set: VocabSetDetail
    let onExit: @MainActor () -> Void
    let onFinish: @MainActor (StudyOutcome) -> Void

    private enum Phase { case leadIn, playing }

    @State private var phase: Phase = .leadIn
    @State private var tick = VocabGames.speedLeadInTicks
    @State private var prompts: [VocabGames.SpeedPrompt] = []
    @State private var index = 0
    @State private var secondsLeft = VocabGames.speedRoundSeconds
    @State private var clock: Task<Void, Never>?
    @State private var answered = 0
    @State private var correct = 0

    private var isUrgent: Bool { secondsLeft <= 10 }

    var body: some View {
        StudyShell(
            title: "Speed",
            subtitle: set.title,
            tone: Theme.amber,
            progress: prompts.isEmpty ? 0 : Double(index) / Double(prompts.count),
            trailing: AnyView(
                HStack(spacing: 6) {
                    if phase == .playing {
                        StudyPill(text: "\(index + 1)/\(prompts.count)", icon: "bolt.fill", tone: Theme.amber)
                        StudyPill(
                            text: formatClock(secondsLeft),
                            icon: "timer",
                            tone: isUrgent ? Theme.danger : Theme.amber
                        )
                    }
                }
            ),
            onExit: onExit
        ) {
            switch phase {
            case .leadIn: leadIn
            case .playing: round
            }
        }
        .task { await begin() }
        .onDisappear { clock?.cancel() }
    }

    private var leadIn: some View {
        VStack(spacing: 26) {
            Spacer()
            Overline("Get ready")
            ZStack {
                Circle().fill(Theme.amberSoft).frame(width: 220, height: 220)
                Text("\(max(1, tick))")
                    .font(.system(size: 108, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Theme.amber)
                    // Re-mounted per tick so the pop replays 3 → 2 → 1.
                    .id(tick)
                    .transition(.scale.combined(with: .opacity))
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.6), value: tick)

            VStack(spacing: 6) {
                Text("\(VocabGames.speedRoundSeconds) seconds. Pick the right meaning.")
                    .font(.system(size: 17, weight: .bold))
                Text("Answer as many as you can.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
            }
            .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(24)
    }

    @ViewBuilder
    private var round: some View {
        if let prompt = prompts.indices.contains(index) ? prompts[index] : nil {
            VStack(spacing: 18) {
                VStack(spacing: 12) {
                    Overline("Which meaning fits?")
                    Text(prompt.word)
                        .font(.system(size: 46, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                    // The clock repeats here on purpose: under time pressure a student's
                    // eyes are on the word, not on the header strip.
                    StudyPill(
                        text: formatClock(secondsLeft),
                        icon: "timer",
                        tone: isUrgent ? Theme.danger : Theme.amber
                    )
                    .scaleEffect(isUrgent ? 1.06 : 1)
                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isUrgent)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
                .padding(.horizontal, 18)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous)
                        .fill(isUrgent ? Theme.dangerSoft : Theme.amberSoft)
                )
                .id(index)
                .transition(.scale(scale: 0.96).combined(with: .opacity))

                VStack(spacing: 12) {
                    ForEach(Array(prompt.options.enumerated()), id: \.element.id) { position, option in
                        Button {
                            answer(prompt: prompt, option: option)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Text("\(position + 1)")
                                    .font(.system(size: 15, weight: .bold))
                                    .frame(width: 32, height: 32)
                                    .background(Circle().fill(Theme.surface2))
                                    .foregroundStyle(Theme.textSecondary)
                                Text(option.text)
                                    // Big type: this is the thing being read under time
                                    // pressure, on a phone, possibly on a bus.
                                    .font(.system(size: 19, weight: .semibold))
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                    .fill(Theme.card)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                    .stroke(Theme.separator, lineWidth: 1)
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(16)
            .animation(.easeOut(duration: 0.18), value: index)
        } else {
            ProgressView()
        }
    }

    @MainActor
    private func answer(prompt: VocabGames.SpeedPrompt, option: VocabGames.SpeedOption) {
        // Reported the instant it is picked: a sixty-second round is one a student
        // abandons mid-way, and the answers up to that point still count.
        runner.record(wordId: prompt.wordId, correct: option.isCorrect)
        answered += 1
        if option.isCorrect { correct += 1 }
        if index + 1 < prompts.count {
            index += 1
        } else {
            end()
        }
    }

    @MainActor
    private func begin() async {
        guard prompts.isEmpty else { return }
        prompts = VocabGames.speedPrompts(for: set.words, pool: set.words)

        for step in stride(from: VocabGames.speedLeadInTicks, through: 1, by: -1) {
            tick = step
            try? await Task.sleep(for: .milliseconds(750))
            if Task.isCancelled { return }
        }
        phase = .playing

        clock?.cancel()
        clock = Task {
            while !Task.isCancelled && secondsLeft > 0 {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                secondsLeft -= 1
            }
            if !Task.isCancelled { end() }
        }
    }

    @MainActor
    private func end() {
        clock?.cancel()
        let ranOut = answered < prompts.count
        onFinish(StudyOutcome(
            title: ranOut ? "Time!" : "Round cleared",
            description: ranOut
                ? "You got through \(ScoreText.string(answered)) of \(ScoreText.string(prompts.count)) words before the clock ran out."
                : "All \(ScoreText.string(prompts.count)) words answered with \(formatClock(secondsLeft)) to spare.",
            stats: [
                ModeStat(label: "Correct", value: ScoreText.string(correct), tone: .success),
                ModeStat(label: "Accuracy", value: "\(ScoreText.string(VocabGames.accuracyPercent(correct: correct, of: answered)))%"),
                ModeStat(label: "Answered", value: "\(ScoreText.string(answered))/\(ScoreText.string(prompts.count))"),
            ],
            restartLabel: "Race again"
        ))
    }
}
