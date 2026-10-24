import SwiftUI
import MasterSATKit

/// The invitation itself: one event, and a seat one tap away.
///
/// The web's `EventInviteDialog` card, word for word. Signing up happens HERE — the whole
/// point is the seat, and a card that only links to a page is the version that already failed
/// on the website twice. "See all events" is for the student who wants the full list first.
struct EventInviteSheet: View {
    let event: LearningEvent
    let api: EventsAPI
    /// "Take me to the list" — the root routes it, then closes this.
    let onSeeAllEvents: () -> Void
    let onClose: () -> Void

    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var isSigningUp = false
    @State private var signedUp = false
    @State private var failure: String?
    @State private var height: CGFloat = 320

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            card
            if signedUp {
                confirmation
            } else {
                if let failure { refusal(failure) }
                actions
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .presentationDetents([.height(max(height, 260))])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("There's an event coming up")
                .appFont(19, weight: .heavy, design: .rounded)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("Take a seat now — there are only so many.")
                .appFont(14, weight: .semibold)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var card: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(systemName: "calendar", size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .appFont(15, weight: .heavy)
                    .fixedSize(horizontal: false, vertical: true)
                // When, and where when the learning center said where — the web's
                // "Tue, Sep 25 · 15:00 · Room 204", on the same formatter the Events page uses.
                Text(whenWhere)
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(CommunityFormat.count(event.seatsLeft, "seat left", "seats left"))
                    .appFont(14, weight: .bold)
                    .padding(.top, 6)
            }
            Spacer(minLength: 0)
        }
    }

    private var whenWhere: String {
        let when = event.startDate.map(CommunityFormat.when) ?? ""
        let parts = [when, event.location].filter { !$0.isEmpty }
        return parts.joined(separator: " · ")
    }

    private static let confirmed = "You're in — your seat is saved."

    /// The seat is taken, said plainly; the sheet closes on its own a beat later so the
    /// student is not left pressing a button to acknowledge good news.
    ///
    /// Under VoiceOver it stays until it is dismissed: a card that vanishes after a second
    /// and a half is one that gets read out halfway and then disappears mid-sentence.
    private var confirmation: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(Self.confirmed, systemImage: "checkmark.circle.fill")
                .appFont(14, weight: .heavy)
                .foregroundStyle(Theme.success)
                .fixedSize(horizontal: false, vertical: true)
            if voiceOver {
                Button("Done") { onClose() }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            }
        }
        // Said out loud, because the buttons that were focused have just been replaced by this
        // card: VoiceOver's focus is left orphaned on a view that no longer exists, and the one
        // thing the student pressed the button to find out goes unspoken.
        .task {
            AccessibilityNotification.Announcement(Self.confirmed).post()
            guard !voiceOver else { return }
            try? await Task.sleep(for: .seconds(1.4))
            onClose()
        }
    }

    /// The server's own sentence ("That event is full. A seat opens if somebody cancels."):
    /// a seat that went between drawing this card and tapping it is news, not an error code.
    private func refusal(_ message: String) -> some View {
        Text(message)
            .appFont(13, weight: .semibold)
            .foregroundStyle(Theme.danger)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Two buttons side by side — and the list underneath, where the web's third link sits:
    /// three buttons across a phone cut "See all events" to "See all…" at the first larger
    /// text size.
    private var actions: some View {
        VStack(spacing: 4) {
            AdaptiveStack(spacing: 10, columnSpacing: 8) {
                Button("Later") { onClose() }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                    .disabled(isSigningUp)
                    .accessibilityLabel("Later — close this")

                Button {
                    Task { await signUp() }
                } label: {
                    HStack(spacing: 7) {
                        if isSigningUp { ProgressView().tint(.white) }
                        Text("Sign up")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(isSigningUp)
                .accessibilityLabel("Sign up for \(event.title)")
            }

            Button("See all events") { onSeeAllEvents() }
                .appFont(13, weight: .heavy, design: .rounded)
                .foregroundStyle(Theme.textSecondary)
                // 44 pt of tappable height, whatever the type size does to the words.
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
                .disabled(isSigningUp)
        }
    }

    @MainActor
    private func signUp() async {
        guard !isSigningUp else { return }
        isSigningUp = true
        failure = nil
        do {
            _ = try await api.signUp(eventId: event.id)
            signedUp = true
        } catch {
            failure = CommunityErrorText.message(error, fallback: "Couldn't take that seat. Try again.")
        }
        isSigningUp = false
    }
}
