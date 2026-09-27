import SwiftUI
import UIKit
import MasterSATKit

/// Register for the SAT — the learning center's checklist, an explicit agreement, then the
/// way through. The site's `RegisterForSatDialog`, word for word.
///
/// The gate is the point. Registration finishes in a Telegram conversation with the
/// registrar, and a student who arrives there without the six items ready wastes the
/// registrar's time as well as their own. So the Telegram button does not exist until the box
/// is ticked — absent, not disabled, because a greyed-out button invites tapping rather than
/// reading. Nothing is recorded: the tick is the student telling themselves they have read
/// it, and it resets every time the sheet opens.
///
/// The payment details and the registrar's handle are hard-coded because no endpoint serves
/// them; they are the constants in `frontend/src/features/services/RegisterForSatDialog.tsx`,
/// copied exactly. The test dates are NOT hard-coded: they come from the admin-managed list,
/// so a sitting that is retired or has passed leaves this checklist on its own.
struct SatChecklistSheet: View {
    let dates: ServicesLoadState<[ExamDateOption]>
    let retryDates: @MainActor () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var agreed = false

    // Where registration actually happens — the learning center's registrar account.
    private static let telegramHandle = "MS_register"
    private static let telegramURL = URL(string: "https://t.me/MS_register")!
    /// How to create a College Board account (https://youtu.be/yQkYwOg5_lc), on YouTube's
    /// privacy-enhanced host, as the site embeds it. Opened outside the app on a tap —
    /// nothing of YouTube's player runs here.
    private static let accountVideoURL = URL(string: "https://www.youtube-nocookie.com/embed/yQkYwOg5_lc")!
    private static let accountVideoPoster = URL(string: "https://i.ytimg.com/vi/yQkYwOg5_lc/hqdefault.jpg")!
    private static let accountVideoTitle = "How to create a College Board account"

    private static let feeUZS = "1,500,000"
    private static let cardNumber = "5614681600990570"
    private static let cardHolder = "Abdulahad Ne'matjonov"
    private static let testCenters = ["Presidential School in Fergana", "Ecocity"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("Send these six things to the registrar on Telegram.")
                        .font(.system(size: 15, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)

                    VStack(alignment: .leading, spacing: 22) {
                        ChecklistStep(number: 1, title: "Your College Board account") {
                            Text("Don't have one yet? Watch this and create it first.")
                                .checklistBody()
                            videoCard
                        }

                        ChecklistStep(number: 2, title: "Your College Board password") {
                            ChecklistCallout(icon: "exclamationmark.triangle.fill", tone: Theme.warning) {
                                Text("Send this only to the registrar, and change your password once your registration is confirmed. Never send it to anyone else who asks.")
                            }
                        }

                        ChecklistStep(number: 3, title: "Test center") {
                            ServicesFlowLayout(spacing: 6, lineSpacing: 6) {
                                ForEach(Self.testCenters, id: \.self) { center in
                                    ChecklistChip(text: center, icon: "mappin.and.ellipse")
                                }
                            }
                        }

                        ChecklistStep(number: 4, title: "Test date") {
                            testDates
                        }

                        ChecklistStep(number: 5, title: "A photo showing your face clearly") {
                            Text("Like a passport photo, but not the same one — take a new picture.")
                                .checklistBody()
                        }

                        ChecklistStep(number: 6, title: "Payment — \(Self.feeUZS) UZS") {
                            VStack(alignment: .leading, spacing: 8) {
                                ChecklistCopyRow(label: "Card", value: Self.cardNumber)
                                ChecklistCopyRow(label: "Cardholder", value: Self.cardHolder)
                                Text("Send the screenshot of your payment to the registrar.")
                                    .checklistBody()
                            }
                        }
                    }

                    ChecklistCallout(icon: "info.circle.fill", tone: Theme.info) {
                        Text("Registration takes around 2–3 days. Please be patient — the registrar will message you when it's done.")
                    }

                    Toggle(isOn: $agreed) {
                        Text("I've read this and I have everything ready.")
                    }
                    .toggleStyle(ServicesCheckboxStyle())

                    // Absent until agreed, not disabled — see the type's comment.
                    if agreed {
                        Button {
                            openURL(Self.telegramURL)
                            dismiss()
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "paperplane.fill").font(.system(size: 14, weight: .bold))
                                Text(verbatim: "Message @\(Self.telegramHandle) on Telegram")
                                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold)).opacity(0.8)
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    } else {
                        ChecklistCallout(icon: "info.circle", tone: Theme.info) {
                            Text("Tick the box above and the Telegram link will appear.")
                        }
                    }
                }
                .padding(20)
                .animation(.easeOut(duration: 0.2), value: agreed)
            }
            .background(Theme.background)
            .navigationTitle("Register for the SAT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    // MARK: - Step 1: the video

    /// A poster with a play button, and the tap leaves the app for YouTube's own
    /// privacy-enhanced player. Not an embedded web view: a student who opens this checklist
    /// has not chosen to load YouTube, and pressing play is that choice.
    private var videoCard: some View {
        Button {
            openURL(Self.accountVideoURL)
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    Color.black.opacity(0.85)
                    AsyncImage(url: Self.accountVideoPoster) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear
                    }
                    Color.black.opacity(0.3)
                    Circle()
                        .fill(.white.opacity(0.95))
                        .frame(width: 54, height: 54)
                        .overlay(
                            Image(systemName: "play.fill")
                                .font(.system(size: 21))
                                .foregroundStyle(.black)
                                .offset(x: 2)
                        )
                        .shadow(color: .black.opacity(0.25), radius: 8, y: 3)
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipped()

                HStack(spacing: 8) {
                    Image(systemName: "play.rectangle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.danger)
                    Text(Self.accountVideoTitle)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Theme.card)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Play: \(Self.accountVideoTitle)")
        .accessibilityHint("Opens YouTube")
        .accessibilityAddTraits(.isLink)
    }

    // MARK: - Step 4: the dates

    /// Four branches, and the last two are different instructions: "we could not load the
    /// dates" means try again, "none are open" means go and ask. Both still point at the
    /// registrar, so the checklist is never a dead end.
    @ViewBuilder private var testDates: some View {
        switch dates {
        case .loading:
            HStack(spacing: 6) {
                ChecklistChip(text: "October 3")
                ChecklistChip(text: "November 7")
            }
            .redacted(reason: .placeholder)
        case .failed:
            // The site puts "Try again" inside the sentence as a link; so does this. The link
            // never leaves the app — it is caught here and turned into a retry.
            Text("Couldn't load the dates. [Try again](mastersat-retry://exam-dates) — or just ask the registrar which are open.")
                .checklistBody()
                .tint(Theme.accent)
                .environment(\.openURL, OpenURLAction { url in
                    guard url.scheme == "mastersat-retry" else { return .systemAction }
                    Task { await retryDates() }
                    return .handled
                })
        case .loaded(let list) where list.isEmpty:
            Text("No dates are open just now. Ask the registrar when the next one opens.")
                .checklistBody()
        case .loaded(let list):
            ServicesFlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(list) { option in
                    ChecklistChip(text: ServicesExamDates.label(for: option))
                }
            }
        }
    }
}

// MARK: - Pieces

private extension Text {
    func checklistBody() -> some View {
        self
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A numbered step: the number on a tinted tile, the title, then what goes with it.
private struct ChecklistStep<Content: View>: View {
    let number: Int
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(verbatim: String(number))
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(Theme.accent)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.accent.opacity(0.1))
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 9) {
                Text(title)
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(Color.primary)
                    .padding(.top, 4)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Step \(number): \(title)")
                    .accessibilityAddTraits(.isHeader)
                content()
            }
            Spacer(minLength: 0)
        }
    }
}

/// A tinted note — the password warning, the timing, the hint under the gate.
private struct ChecklistCallout<Content: View>: View {
    let icon: String
    let tone: Color
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tone)
                .padding(.top, 1)
            content()
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(tone.opacity(0.12))
        )
    }
}

/// A test centre or a test date.
private struct ChecklistChip: View {
    let text: String
    var icon: String?

    var body: some View {
        HStack(spacing: 5) {
            if let icon {
                Image(systemName: icon).font(.system(size: 11, weight: .bold))
            }
            Text(text)
                .font(.system(size: 13, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Theme.accent)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Capsule().fill(Theme.accent.opacity(0.1)))
    }
}

/// A labelled value with a copy button. The card is laid out as a row to copy rather than a
/// wall of digits, because a student typing sixteen digits from memory into a banking app is
/// how money reaches the wrong account.
private struct ChecklistCopyRow: View {
    let label: String
    let value: String

    @State private var copied = false
    @State private var reset: Task<Void, Never>?

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(Theme.textSecondary)
                Text(verbatim: value)
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 8)
            Button(action: copy) {
                HStack(spacing: 5) {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 11, weight: .bold))
                    Text(copied ? "Copied" : "Copy")
                        .font(.system(size: 12.5, weight: .bold))
                }
                .foregroundStyle(copied ? Theme.success : Theme.accent)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill((copied ? Theme.success : Theme.accent).opacity(0.12)))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(copied ? "Copied" : "Copy \(label.lowercased())")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .onDisappear { reset?.cancel() }
    }

    private func copy() {
        UIPasteboard.general.string = value
        copied = true
        reset?.cancel()
        reset = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
