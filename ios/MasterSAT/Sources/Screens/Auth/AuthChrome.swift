import SwiftUI
import MasterSATKit

/// The brand mark and the form controls the auth and account screens share.
///
/// The marketing panel that used to live here is gone with the Register form: sign-in is one
/// quiet page now, and nothing on it is selling the platform to someone the centre has
/// already enrolled. The brand gradient and the lockup went with it — the three screens that
/// still show the mark (sign-in, the completion gate, About) each draw it on their own
/// surface, and the update screen loads the asset itself.

// MARK: - Brand

/// The mark itself — the shield from `frontend/public/images/logo.png`.
///
/// The asset is a template, so it takes the colour it is given: white on the brand panel,
/// brand blue on a card. That is the same thing the web does with
/// `filter: brightness(0) invert(1)`, minus the filter.
struct BrandMark: View {
    var height: CGFloat = 44
    var tint: Color = .white

    var body: some View {
        Image("BrandMark")
            .resizable()
            .renderingMode(.template)
            .aspectRatio(contentMode: .fit)
            .frame(height: height)
            .foregroundStyle(tint)
            .accessibilityLabel("MasterSAT")
    }
}

/// The mark arriving: it springs up from 70% — chrome above the form, never over it, so a
/// spring is allowed. Under Reduce Motion it only fades in.
///
/// Not private: the sign-in page's logo tile wears it too, and the spring is the phase-4 one
/// so the two screens that show the mark do not arrive differently.
struct LogoArrival: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(arrived || reduceMotion ? 1 : 0.7)
            .opacity(arrived ? 1 : 0)
            .onAppear {
                guard !arrived else { return }
                withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.pop.delay(0.1)) { arrived = true }
            }
    }
}

// MARK: - Form controls

/// The sign-in page's input box: a soft grey fill, no border, no label above it — the mockup's
/// `#f4f5f8` field, where the placeholder is the label.
///
/// The fill is a token (`Theme.surface2`, the system's `tertiarySystemFill`), never the literal
/// `#f4f5f8`: a fixed near-white box in dark mode is a white slab with white text on it, which
/// is exactly the trap `Theme.ink`/`Theme.onInk` exists to stop elsewhere.
///
/// `minHeight`, not `height`: 48 pt clears the 44 pt target the mockup's 40 pt box does not
/// (it was drawn 270 pt wide), and at AX3 the box has to grow with the type rather than clip it.
struct SoftField<Content: View>: View {
    /// Bumped when what was typed here was refused — the box shakes (`focusShake`).
    var shakes: Int = 0
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 8) {
            content()
        }
        .padding(.horizontal, 13)
        .frame(minHeight: 48)
        .background(Theme.surface2)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .focusShake(shakes, cornerRadius: Theme.Radius.control)
    }
}

/// The site's `Alert`: a tinted panel, a bold line, and room underneath for the one action
/// that gets the student out of it.
struct AuthAlert<Action: View>: View {
    enum Tone { case danger, warning, info }

    let tone: Tone
    let message: String
    @ViewBuilder var action: () -> Action

    private var colour: Color {
        switch tone {
        case .danger: return Theme.danger
        case .warning: return Theme.warning
        case .info: return Theme.info
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .danger ? "exclamationmark.circle.fill" : "info.circle.fill")
                .appFont(15, weight: .bold)
                .foregroundStyle(colour)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .appFont(13, weight: .semibold)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                action()
            }
            Spacer(minLength: 0)
        }
        .padding(13)
        .background(colour.opacity(0.11))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(colour.opacity(0.28), lineWidth: 1)
        )
    }
}

extension AuthAlert where Action == EmptyView {
    init(tone: Tone, message: String) {
        self.init(tone: tone, message: message, action: { EmptyView() })
    }
}

/// The eye that reveals a password, and the `••••••••` field behind it.
///
/// Swapping `SecureField` for `TextField` replaces the view, and a replaced view is not the
/// focused one — so focus is put back by hand. Without that, revealing what you typed costs
/// you the keyboard and the caret.
///
/// It sits in a `SoftField`, where there is no label above the box: `label` is the placeholder
/// as well as the name VoiceOver reads, so the box still says what it is.
struct PasswordField: View {
    let label: String
    @Binding var text: String
    var textContentType: UITextContentType = .password
    var submitLabel: SubmitLabel = .go
    @FocusState.Binding var focus: AuthFocus?
    let field: AuthFocus
    /// Bumped when the server refused this password — the box shakes.
    var shakes: Int = 0
    let onSubmit: () -> Void

    @State private var revealed = false

    var body: some View {
        SoftField(shakes: shakes) {
            Group {
                // `verbatim` for the placeholder: a plain string is a LocalizedStringKey, which
                // SwiftUI parses as markdown before drawing it.
                if revealed {
                    TextField(text: $text, prompt: Text(verbatim: label)) { Text(verbatim: label) }
                } else {
                    SecureField(text: $text, prompt: Text(verbatim: label)) { Text(verbatim: label) }
                }
            }
            .textContentType(textContentType)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: field)
            .submitLabel(submitLabel)
            .onSubmit(onSubmit)

            Button {
                revealed.toggle()
                focus = field
            } label: {
                Image(systemName: revealed ? "eye.slash" : "eye")
                    .appFont(15, weight: .semibold)
                    .foregroundStyle(Theme.textLabel)
                    // A full 44 pt square to hit.
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(revealed ? "Hide password" : "Show password")
            .capDynamicType(label: revealed ? "Hide password" : "Show password", systemImage: revealed ? "eye.slash" : "eye")
        }
    }
}

/// Which box the keyboard is in. Two, since the sign-in page is the only form here: the one
/// identity field (`email` — it also takes a phone or a username) and the password.
enum AuthFocus: Hashable {
    case email, password
}
