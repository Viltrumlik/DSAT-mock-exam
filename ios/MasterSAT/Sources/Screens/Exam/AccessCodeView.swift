import SwiftUI
import MasterSATKit

/// The gate on an invigilated midterm: the teacher reads a code to the room, the student
/// types it in, and only then does the clock start.
///
/// This is deliberately not an error screen. The student is holding the code — they need a
/// field, not an apology.
struct AccessCodeView: View {
    @Bindable var runner: ExamRunner
    let onClose: @MainActor () -> Void

    @State private var code = ""
    @State private var isSubmitting = false
    @FocusState private var isFocused: Bool

    /// The codes the teacher console generates are six digits.
    private let expectedLength = 6

    private var canSubmit: Bool {
        code.count >= expectedLength && !isSubmitting
    }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()

            Image(systemName: "lock.circle")
                .font(.system(size: 44))
                .foregroundStyle(Theme.accent)

            VStack(spacing: 6) {
                Text("Access code").font(.title2.bold())
                Text(runner.accessCodeMessage ?? "Enter the code your teacher gives the room.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            TextField("000000", text: $code)
                .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($isFocused)
                .padding(.vertical, 10)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onChange(of: code) { _, new in
                    // Digits only, and never longer than the code actually is — a stray
                    // character is a wrong code the student cannot see.
                    let digits = new.filter(\.isNumber)
                    code = String(digits.prefix(expectedLength))
                }

            if let error = runner.lastError?.errorDescription {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                isFocused = false
                isSubmitting = true
                Task {
                    await runner.submitAccessCode(code)
                    isSubmitting = false
                }
            } label: {
                if isSubmitting {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Start").bold().frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Theme.accent)
            .disabled(!canSubmit)

            Button("Not now", action: onClose)
                .tint(.secondary)

            Spacer()
        }
        .padding(28)
        .onAppear { isFocused = true }
    }
}

/// A past paper with its clock stopped.
///
/// Only past papers can reach this state — the two timed sittings refuse to pause at all.
struct ExamPausedView: View {
    @Bindable var runner: ExamRunner
    let onClose: @MainActor () -> Void

    @State private var isResuming = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "pause.circle.fill")
                .font(.system(size: 44))
                .foregroundStyle(Theme.accent)

            Text("Paused").font(.title2.bold())
            Text("Your answers are saved and the clock is stopped. Pick this up whenever you like.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                isResuming = true
                Task {
                    // The deliberate press, not the lifecycle handler — that one is
                    // guarded against repeated scene-phase changes and would no-op here.
                    await runner.resume()
                    isResuming = false
                }
            } label: {
                if isResuming {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Continue").bold().frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Theme.accent)
            .disabled(isResuming)

            Button("Leave for now", action: onClose)
                .tint(.secondary)

            Spacer()
        }
        .padding(28)
    }
}
