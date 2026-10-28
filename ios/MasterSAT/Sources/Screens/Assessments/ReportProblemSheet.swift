import SwiftUI
import MasterSATKit

/// Which question a report is about, settled when the student asked to report it.
///
/// A value, so the sheet is presented by `.sheet(item:)`: the runner's page may turn while
/// the sheet is being written, and a report must stay about the question it was opened on.
struct ReportedQuestion: Identifiable, Hashable {
    let questionId: Int
    /// 1-based, as the card shows it.
    let number: Int

    var id: Int { questionId }
}

/// "Report a problem with this question" — the site's dialog, at phone width.
///
/// Opened from two places that differ in one thing only: the runner names the attempt it is
/// in, the review does not. Everything else — the five categories, their wording, the 2000
/// character cap, the two thank-yous — is the website's, because both surfaces feed the one
/// ops queue and a report worded differently there is a report nobody matches up.
///
/// Over the runner it is a focus zone's guest: it owns no part of the page behind it. The
/// clock does not exist in this runner, but the answers do, and nothing here touches them.
struct ReportProblemSheet: View {
    let system: QuestionReportSystem
    let questionId: Int
    /// The attempt this report was made during, when there is one. The review has none.
    var attemptId: Int?
    /// The number the student sees on the card — for the subtitle, 1-based.
    var questionNumber: Int?

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var category: QuestionReportCategory = .wrongAnswer
    @State private var message = ""
    @State private var inFlight = false
    @State private var error: String?
    /// Set once the report lands, and the sheet turns into its thank-you. Nil while writing.
    @State private var sent: Sent?
    @State private var detent: PresentationDetent = .medium
    @FocusState private var detailsFocused: Bool
    /// Where VoiceOver goes once the form has been replaced by its answer: the button the
    /// student was on no longer exists, and focus left on it lands nowhere.
    @AccessibilityFocusState private var thanksFocused: Bool

    /// How the report was received. A repeat is still a success — the student is thanked for
    /// it, in words that say the first one was not lost.
    private enum Sent {
        case fresh
        case alreadyReported

        var title: String {
            switch self {
            case .fresh: return "Thanks! Your report was sent to our team."
            case .alreadyReported: return "You've already reported this question — thanks!"
            }
        }
    }

    private var subtitle: String {
        if let questionNumber {
            return "Question \(ScoreText.string(questionNumber)) — tell us what looks wrong."
        }
        return "Tell us what looks wrong with this question."
    }

    var body: some View {
        ScrollView {
            if let sent {
                thanks(sent)
            } else {
                form
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if sent == nil { buttons }
        }
        .background(NewLook.sheet)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        // A report half-sent is a report sent twice: the sheet stays put until the request
        // has an answer.
        .interactiveDismissDisabled(inFlight)
        .onChange(of: detailsFocused) { _, focused in
            if focused { detent = .large }
        }
    }

    // MARK: - Writing it

    private var form: some View {
        VStack(alignment: .leading, spacing: 18) {
            NewLookSheetHeader(title: "Report a problem", subtitle: subtitle, onClose: nil) {
                NewLookTile(systemName: "exclamationmark.bubble.fill")
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("What's the issue?")
                    .appFont(15, weight: .bold)
                    .foregroundStyle(NewLook.ink2)
                // Rows rather than a menu: five short lines a thumb can hit without a second
                // tap, and every option readable at once — the web's `<select>` is a phone's
                // worst control.
                VStack(spacing: 8) {
                    ForEach(QuestionReportCategory.allCases) { option in
                        categoryRow(option)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("Details (optional)")
                    .appFont(15, weight: .bold)
                    .foregroundStyle(NewLook.ink2)
                TextField(
                    "",
                    text: $message,
                    prompt: Text(verbatim: "e.g. The correct answer should be B, not C.").foregroundStyle(NewLook.muted),
                    axis: .vertical
                )
                .lineLimit(3...6)
                .focused($detailsFocused)
                .reportFieldStyle(focused: detailsFocused)
                // Capped while typing, not on send: a student who has written past the limit
                // should find that out at the 2001st character, not after tapping Send.
                .onChange(of: message) { _, value in
                    let clamped = QuestionReport.clampedMessage(value)
                    if clamped != value { message = clamped }
                }
                Text("Anything that helps us find and fix it.")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(NewLook.muted)
            }

            // The server's own sentence, and the sheet stays open on it: the student's words
            // are still in the box and the next tap sends them.
            if let error { ReportSheetError(message: error) }
        }
        .padding(.horizontal, 16)
        .padding(.top, 22)
        .padding(.bottom, 12)
    }

    /// Cancel · Send report, pinned under the form.
    private var buttons: some View {
        HStack(spacing: 10) {
            Button("Cancel") { dismiss() }
                .buttonStyle(NewLookButtonStyle(kind: .tint, size: .large))
                .disabled(inFlight)
            Button {
                Task { await submit() }
            } label: {
                ZStack {
                    // The title keeps its width while the spinner shows, so the button does not
                    // jump under the student's thumb.
                    Label("Send report", systemImage: "paperplane")
                        .opacity(inFlight ? 0 : 1)
                    if inFlight { ProgressView().tint(.white) }
                }
            }
            .buttonStyle(NewLookButtonStyle(size: .large))
            .disabled(inFlight)
            .accessibilityLabel(inFlight ? "Sending report" : "Send report")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(NewLook.sheet)
    }

    private func categoryRow(_ option: QuestionReportCategory) -> some View {
        let chosen = category == option
        return Button {
            category = option
        } label: {
            HStack(spacing: 12) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20, weight: chosen ? .semibold : .regular))
                    .foregroundStyle(chosen ? NewLook.blue : NewLook.chevron)
                    .accessibilityHidden(true)
                Text(option.label)
                    .appFont(16, weight: chosen ? .bold : .medium)
                    .foregroundStyle(NewLook.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .newLookOptionSurface(chosen ? .picked : .idle, idleFill: NewLook.card)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
        .animation(Motion.focus, value: chosen)
    }

    // MARK: - Sent

    private func thanks(_ sent: Sent) -> some View {
        VStack(spacing: 14) {
            Circle()
                .fill(NewLook.green50)
                .frame(width: 76, height: 76)
                .overlay {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(NewLook.green)
                }
                .accessibilityHidden(true)
            Text(sent.title)
                .appDisplayFont(19)
                .foregroundStyle(NewLook.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityFocused($thanksFocused)
            Button("Done") { dismiss() }
                .buttonStyle(NewLookButtonStyle(size: .large))
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 36)
        .accessibilityElement(children: .contain)
    }

    @MainActor
    private func submit() async {
        guard !inFlight else { return }
        inFlight = true
        error = nil
        detailsFocused = false
        let api = QuestionReportsAPI(client: session.client)
        do {
            let result = try await api.submit(QuestionReport(
                system: system,
                questionId: questionId,
                category: category,
                message: message,
                attemptId: attemptId
            ))
            let outcome: Sent = result.deduped ? .alreadyReported : .fresh
            sent = outcome
            // The form the student was reading has just been replaced. Said out loud, and focus
            // moved to what replaced it — otherwise the button they pressed simply vanishes.
            announce(outcome.title)
            thanksFocused = true
        } catch let failure as APIError {
            // `errorDescription` is total today; a nil would leave the sheet silent and the tap
            // looking like it did nothing, which is the one outcome worse than an error.
            error = failure.errorDescription ?? Self.sendFailed
            announce(error ?? Self.sendFailed)
        } catch {
            self.error = error.localizedDescription
            announce(self.error ?? Self.sendFailed)
        }
        inFlight = false
    }

    private static let sendFailed = "Your report didn't send. Nothing has changed — try again."

    private func announce(_ sentence: String) {
        AccessibilityNotification.Announcement(sentence).post()
    }
}

/// A refusal or a failure, in the server's words.
private struct ReportSheetError: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(NewLook.red)
                .padding(.top, 1)
                .accessibilityHidden(true)
            Text(message)
                .appFont(14, weight: .semibold)
                .foregroundStyle(NewLook.redInk)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(NewLook.red50, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private extension View {
    /// The kit's field: white, r16, a hairline that turns blue while typing.
    func reportFieldStyle(focused: Bool) -> some View {
        self
            .appFont(16)
            .foregroundStyle(NewLook.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .frame(minHeight: 96, alignment: .topLeading)
            .background(NewLook.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(focused ? NewLook.blue : NewLook.field, lineWidth: focused ? 2 : 1)
            )
    }
}
