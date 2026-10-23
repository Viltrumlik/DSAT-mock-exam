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
            if sent == nil {
                ServicesSheetButtons(
                    secondaryTitle: "Cancel",
                    primaryTitle: "Send report",
                    primaryEnabled: true,
                    inFlight: inFlight,
                    secondary: { dismiss() },
                    primary: { Task { await submit() } }
                )
            }
        }
        .background(Theme.background)
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
            HStack(alignment: .top, spacing: 12) {
                IconTile(systemName: "exclamationmark.bubble.fill", tone: Theme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Report a problem")
                        .appFont(17, weight: .heavy)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .appFont(13.5, weight: .medium)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("What's the issue?")
                    .appFont(14, weight: .bold)
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
                    .appFont(14, weight: .bold)
                TextField(
                    "",
                    text: $message,
                    prompt: Text(verbatim: "e.g. The correct answer should be B, not C."),
                    axis: .vertical
                )
                .lineLimit(3...6)
                .focused($detailsFocused)
                .reportFieldStyle(focused: detailsFocused)
                // Capped while typing, not on send: a student who has written past the limit
                // should find that out at the 2001st character, not after tapping Send.
                .onChange(of: message) { _, value in
                    if value.count > QuestionReport.messageLimit {
                        message = String(value.prefix(QuestionReport.messageLimit))
                    }
                }
                Text("Anything that helps us find and fix it.")
                    .appFont(12, weight: .medium)
                    .foregroundStyle(Theme.textSecondary)
            }

            // The server's own sentence, and the sheet stays open on it: the student's words
            // are still in the box and the next tap sends them.
            if let error { ReportSheetError(message: error) }
        }
        .padding(20)
    }

    private func categoryRow(_ option: QuestionReportCategory) -> some View {
        let chosen = category == option
        return Button {
            category = option
        } label: {
            HStack(spacing: 10) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .appFont(17)
                    .foregroundStyle(chosen ? Theme.accent : Theme.textLabel)
                    .accessibilityHidden(true)
                Text(option.label)
                    .appFont(14.5, weight: chosen ? .bold : .medium)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(chosen ? Theme.accentSoft : Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(chosen ? Theme.accent : Theme.separator.opacity(0.7), lineWidth: chosen ? 1.5 : 0.5)
            )
            .hitTarget(44)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
        .animation(Motion.focus, value: chosen)
    }

    // MARK: - Sent

    private func thanks(_ sent: Sent) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .appFont(44)
                .foregroundStyle(Theme.success)
                .accessibilityHidden(true)
            Text(sent.title)
                .appFont(16, weight: .bold)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Done") { dismiss() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, 2)
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
            sent = result.deduped ? .alreadyReported : .fresh
        } catch let failure as APIError {
            error = failure.errorDescription
        } catch {
            self.error = error.localizedDescription
        }
        inFlight = false
    }
}

/// A refusal or a failure, in the server's words.
private struct ReportSheetError: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .appFont(14)
                .foregroundStyle(Theme.danger)
                .padding(.top, 1)
                .accessibilityHidden(true)
            Text(message)
                .appFont(13.5, weight: .semibold)
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.dangerSoft)
        )
        .accessibilityElement(children: .combine)
    }
}

private extension View {
    /// The site's input: a card-coloured field with a hairline that turns blue while typing.
    func reportFieldStyle(focused: Bool) -> some View {
        self
            .appFont(15)
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(focused ? Theme.accent : Theme.separator.opacity(0.7), lineWidth: focused ? 1.5 : 0.5)
            )
    }
}
