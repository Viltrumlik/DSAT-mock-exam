import SwiftUI
import MasterSATKit

// Pieces the account screens share. Prefixed `Account` so they cannot collide with anything
// another screen defines.

/// A load that is in flight, landed, or failed — the three states every account page draws.
/// "Nothing here" is only ever a successful empty answer, never a failure.
enum AccountLoadState<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// A settings page's headline: the board's big title and one line on what the page is for —
/// the web's section `PanelHeader`, in the app's board idiom.
struct AccountPageHeading<Accessory: View>: View {
    let title: String
    let description: String
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                PageTitle(title)
                accessory()
            }
            Text(description)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

extension AccountPageHeading where Accessory == EmptyView {
    init(title: String, description: String) {
        self.init(title: title, description: description, accessory: { EmptyView() })
    }
}

/// "Confirmed", "Not confirmed", "Connected", "This device" — the web's small status pill.
struct AccountStatusPill: View {
    let text: String
    var tone: Color = Theme.success

    var body: some View {
        Text(text)
            .font(.system(size: 11.5, weight: .heavy))
            .foregroundStyle(tone)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(Capsule().fill(tone.opacity(0.13)))
            .fixedSize()
    }
}

/// The web's `pill()` buttons: solid, soft (tinted) or quiet (text only), in one tone.
struct AccountPillButtonStyle: ButtonStyle {
    enum Kind { case solid, soft, quiet }

    var kind: Kind = .soft
    var tone: Color = Theme.accent

    func makeBody(configuration: Configuration) -> some View {
        AccountPillBody(configuration: configuration, kind: kind, tone: tone)
    }

    /// A separate view so it can read `isEnabled`, which a `ButtonStyle` cannot.
    private struct AccountPillBody: View {
        let configuration: ButtonStyleConfiguration
        let kind: Kind
        let tone: Color
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(kind == .solid ? Color.white : tone)
                .padding(.horizontal, kind == .quiet ? 8 : 13)
                .padding(.vertical, 8)
                .background(
                    Capsule().fill(fill.opacity(configuration.isPressed ? 0.75 : 1))
                )
                .contentShape(Capsule())
                .opacity(isEnabled ? 1 : 0.5)
        }

        private var fill: Color {
            switch kind {
            case .solid: return tone
            case .soft: return tone.opacity(0.13)
            case .quiet: return Color.clear
            }
        }
    }
}

/// The site's form field — bold label, bordered box, an icon inside it — with the hint or the
/// server's refusal underneath, the way the web's `Field` shows them.
struct AccountTextField<Focus: Hashable>: View {
    let label: String
    var icon: String?
    @Binding var text: String
    var prompt: String?
    var hint: String?
    var error: String?
    var contentType: UITextContentType?
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .words
    var submitLabel: SubmitLabel = .next
    let focus: FocusState<Focus?>.Binding
    let field: Focus
    var onSubmit: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            AccountFieldBox(icon: icon, invalid: error != nil) {
                // `Text(verbatim:)`: a plain-string prompt is a LocalizedStringKey, and SwiftUI
                // would draw an address in it as a tappable link inside an empty field.
                TextField(text: $text, prompt: prompt.map { Text(verbatim: $0) }) { Text(label) }
                    .textContentType(contentType)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(capitalization)
                    .autocorrectionDisabled()
                    .submitLabel(submitLabel)
                    .focused(focus, equals: field)
                    .onSubmit(onSubmit)
            }
            AccountFieldNote(hint: hint, error: error)
        }
    }
}

/// A password box with the eye that reveals it. One `revealed` flag is shared by every field
/// of a form, as on the web, so "show" shows the three together.
struct AccountSecureField<Focus: Hashable>: View {
    let label: String
    @Binding var text: String
    @Binding var revealed: Bool
    var hint: String?
    var error: String?
    var contentType: UITextContentType = .password
    var submitLabel: SubmitLabel = .next
    let focus: FocusState<Focus?>.Binding
    let field: Focus
    var onSubmit: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            AccountFieldBox(icon: "lock", invalid: error != nil) {
                Group {
                    if revealed {
                        TextField(text: $text, prompt: Text(verbatim: "••••••••")) { Text(label) }
                    } else {
                        SecureField(text: $text, prompt: Text(verbatim: "••••••••")) { Text(label) }
                    }
                }
                .textContentType(contentType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(submitLabel)
                .focused(focus, equals: field)
                .onSubmit(onSubmit)

                Button {
                    revealed.toggle()
                    // Swapping SecureField for TextField replaces the view, and the replacement
                    // is not the focused one — put the caret back by hand.
                    focus.wrappedValue = field
                } label: {
                    Image(systemName: revealed ? "eye.slash" : "eye")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                        .frame(width: 30, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(revealed ? "Hide passwords" : "Show passwords")
            }
            AccountFieldNote(hint: hint, error: error)
        }
    }
}

/// The bordered box itself — `AuthField`'s look, plus the red edge of a refused value.
struct AccountFieldBox<Content: View>: View {
    var icon: String?
    var invalid = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 10) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(invalid ? Theme.danger : Theme.textLabel)
                    .frame(width: 16)
            }
            content()
        }
        .padding(.horizontal, 13)
        .frame(height: 48)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(invalid ? Theme.danger.opacity(0.8) : Theme.separator.opacity(0.7), lineWidth: 1)
        )
    }
}

/// The line under a field: the refusal when there is one, else the hint.
struct AccountFieldNote: View {
    var hint: String?
    var error: String?

    var body: some View {
        if let error {
            Text(error)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
        } else if let hint {
            Text(hint)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// A profile photo in the settings well: the web's rounded square, or initials on the brand
/// tint when there is no photo (or it has not loaded).
struct AccountAvatar: View {
    let url: String?
    let name: String
    var size: CGFloat = 72

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initials
                    }
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .stroke(Theme.card, lineWidth: 3)
        )
        .accessibilityLabel(Text(verbatim: name.isEmpty ? "Profile photo" : "\(name)'s photo"))
    }

    private var initials: some View {
        ZStack {
            Theme.accent
            Text(verbatim: Self.initials(of: name))
                .font(.system(size: size * 0.34, weight: .heavy))
                .foregroundStyle(.white)
        }
    }

    static func initials(of name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }
}

/// A row that opens a settings page: the tile, the page's name, the web menu's hint.
struct AccountMenuRow<Destination: View>: View {
    let icon: String
    let tone: Color
    let title: String
    let hint: String
    var badge: String?
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 13) {
                IconTile(systemName: icon, tone: tone)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.primary)
                    Text(hint)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                if let badge { AccountStatusPill(text: badge, tone: Theme.warning) }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
            }
            .cardStyle()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Toasts in the product's one toast style.
extension RewardsToastMessage {
    static func accountSuccess(_ text: String) -> RewardsToastMessage { .init(tone: .success, text: text) }
    static func accountNotice(_ text: String) -> RewardsToastMessage { .init(tone: .notice, text: text) }
}
