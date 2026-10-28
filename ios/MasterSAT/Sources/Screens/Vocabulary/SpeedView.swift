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
    /// The last word has been answered; the end screen follows one `focusTap` beat later.
    @State private var finishing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isUrgent: Bool { secondsLeft <= 10 }

    var body: some View {
        StudyShell(
            title: "Speed",
            subtitle: set.title,
            tone: StudyMode.speed.tone,
            progress: prompts.isEmpty ? 0 : Double(index) / Double(prompts.count),
            trailing: AnyView(
                HStack(spacing: 6) {
                    if phase == .playing {
                        StudyPill(text: "\(index + 1)/\(prompts.count)", icon: "bolt.fill",
                                  tone: StudyMode.speed.tone, ink: StudyMode.speed.ink)
                        clockPill
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
        // The last answer's tick plays on this view, and the end screen replaces it: one beat lets
        // it be felt. Leaving inside that beat cuts the wait short but the round still ends — it
        // is over, and ending it is what grades the run.
        .task(id: finishing) {
            guard finishing else { return }
            try? await Task.sleep(for: .seconds(Motion.focusTapSeconds))
            end()
        }
        .onDisappear { clock?.cancel() }
        // One tick per answer, the same for every answer.
        .sensoryFeedback(.selection, trigger: answered)
    }

    private var leadIn: some View {
        VStack(spacing: 26) {
            Spacer()
            Text("Get ready").newLookCaps()
            ZStack {
                Circle().fill(StudyMode.speed.tone.opacity(0.14)).frame(width: 220, height: 220)
                Text("\(max(1, tick))")
                    .appDisplayFont(108, monospacedDigits: true)
                    .foregroundStyle(StudyMode.speed.tone)
                    // Re-mounted per tick, so each number comes in — 3 → 2 → 1 — without
                    // overshoot. Under Reduce Motion they crossfade.
                    .id(tick)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.8).combined(with: .opacity))
            }
            .animation(Motion.focus, value: tick)

            VStack(spacing: 6) {
                Text("\(VocabGames.speedRoundSeconds) seconds. Pick the right meaning.")
                    .appFont(17, weight: .bold)
                    .foregroundStyle(NewLook.ink)
                Text("Answer as many as you can.")
                    .appFont(14)
                    .foregroundStyle(NewLook.ink4)
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
                    Text("Which meaning fits?").newLookCaps(NewLook.ink4)
                    Text(prompt.word)
                        .appDisplayFont(46)
                        .tracking(-1)
                        .foregroundStyle(NewLook.ink)
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                    // The clock repeats here on purpose: under time pressure a student's
                    // eyes are on the word, not on the header strip.
                    clockPill
                    // Under ten seconds the clock pulses once a second, with the second — not a
                    // loop breathing beside the word. It still pulses under Reduce Motion, as a
                    // colour only: it lights up instead of growing.
                    .keyframeAnimator(initialValue: 0.0, trigger: isUrgent ? secondsLeft : 0) { [calm = reduceMotion] pill, pulse in
                        pill
                            .scaleEffect(calm ? 1 : 1 + 0.08 * pulse)
                            .overlay {
                                Capsule()
                                    .fill(NewLook.red.opacity(calm ? 0.25 * pulse : 0))
                                    .allowsHitTesting(false)
                            }
                    } keyframes: { _ in
                        KeyframeTrack {
                            CubicKeyframe(1.0, duration: 0.1)
                            CubicKeyframe(0.0, duration: 0.15)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
                .padding(.horizontal, 18)
                .background(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(isUrgent ? NewLook.red50 : StudyMode.speed.tone.opacity(0.14))
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
                                    .appFont(15, weight: .bold)
                                    .capDynamicType()
                                    .frame(width: 32, height: 32)
                                    .background(Circle().fill(NewLook.sheet))
                                    .foregroundStyle(NewLook.ink4)
                                Text(option.text)
                                    // Big type: this is the thing being read under time
                                    // pressure, on a phone, possibly on a bus.
                                    .appFont(19, weight: .semibold)
                                    .foregroundStyle(NewLook.ink)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
                            .background {
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .fill(NewLook.card)
                                    .newLookShadow(.tile)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(FocusPress())
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

    /// The clock, in the header and under the word: amber, red under ten seconds.
    private var clockPill: some View {
        StudyPill(
            text: formatClock(secondsLeft),
            icon: "timer",
            tone: isUrgent ? NewLook.red : StudyMode.speed.tone,
            ink: isUrgent ? NewLook.redInk : StudyMode.speed.ink
        )
    }

    @MainActor
    private func answer(prompt: VocabGames.SpeedPrompt, option: VocabGames.SpeedOption) {
        guard !finishing else { return }
        // Reported the instant it is picked: a sixty-second round is one a student
        // abandons mid-way, and the answers up to that point still count.
        runner.record(wordId: prompt.wordId, correct: option.isCorrect)
        answered += 1
        if option.isCorrect { correct += 1 }
        if index + 1 < prompts.count {
            index += 1
        } else {
            // The clock stops with the last word, as `end()` would stop it.
            clock?.cancel()
            finishing = true
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
                .accuracy(VocabGames.accuracyPercent(correct: correct, of: answered)),
                ModeStat(label: "Answered", value: "\(ScoreText.string(answered))/\(ScoreText.string(prompts.count))"),
            ],
            restartLabel: "Race again"
        ))
    }
}
