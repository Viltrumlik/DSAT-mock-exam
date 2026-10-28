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
/// The asset is a template, so it takes the colour it is given: white on the sign-in page's
/// brand-blue tile, brand blue on the gate's and About's own surface. That is the same thing
/// the web does with `filter: brightness(0) invert(1)`, minus the filter.
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
    /// The glyph at the leading edge (the new look's person and lock, mockup 01).
    var systemImage: String?
    /// The box was refused: a red edge and a red glyph (mockup 02).
    var invalid = false
    @ViewBuilder let content: () -> Content

    private var radius: CGFloat { 20 }

    var body: some View {
        HStack(spacing: 12) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(invalid ? NewLook.red : NewLook.muted)
                    .frame(width: 24)
                    .accessibilityHidden(true)
            }
            content()
        }
        .appFont(17, weight: .regular)
        .padding(.leading, 18)
        .padding(.trailing, 12)
        .frame(minHeight: 56)
        // The new look: a white box with a hairline, not the grey fill (mockups 01–03).
        .background(NewLook.card, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(invalid ? NewLook.red : NewLook.field, lineWidth: invalid ? 2 : 1)
        )
        .focusShake(shakes, cornerRadius: radius)
    }
}

/// The site's `Alert`: a tinted panel, a bold line, and room underneath for the one action
/// that gets the student out of it.
struct AuthAlert<Action: View>: View {
    enum Tone { case danger, warning, info }

    let tone: Tone
    let message: String
    @ViewBuilder var action: () -> Action

    /// The new look's note colours: red, amber or blue on their own tint (mockup 02).
    private var fill: Color {
        switch tone {
        case .danger: return NewLook.red50
        case .warning: return NewLook.orange50
        case .info: return NewLook.blue50
        }
    }

    private var glyph: Color {
        switch tone {
        case .danger: return NewLook.red
        case .warning: return NewLook.orange
        case .info: return NewLook.blueText
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .danger ? "exclamationmark.circle.fill" : "info.circle.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(glyph)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .appFont(15, weight: .semibold)
                    .foregroundStyle(NewLook.ink)
                    .fixedSize(horizontal: false, vertical: true)
                action()
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .background(fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(glyph.opacity(0.22), lineWidth: 1)
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
    /// The new look's leading lock (sign-in, first sign-in); nil keeps the bare box.
    var systemImage: String? = "lock"
    var invalid = false
    let onSubmit: () -> Void

    @State private var revealed = false

    var body: some View {
        SoftField(shakes: shakes, systemImage: systemImage, invalid: invalid) {
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
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(NewLook.muted)
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

// MARK: - The new look's blue top

/// The sign-in's blue top (mockup 01): the band's blue under the status bar, the MASTER SAT
/// wordmark in the middle, and two big shields drifting behind it (the Today band's watermark).
/// The wordmark springs in from 70 % on arrival (`LogoArrival`); Reduce Motion only fades it, and
/// the shields hold still (`ShieldWatermark`).
struct AuthBand: View {
    var height: CGFloat = 330
    /// How far the wordmark sits below the band's middle. The front-door states lift it (their
    /// icon tile takes the band's bottom edge) and drop it again for the offline strip.
    var markTop: CGFloat = 40

    var body: some View {
        ZStack {
            ClassTabPalette.band
            ShieldWatermark()
                .scaleEffect(1.4)
                .offset(x: 120, y: 30)
            ShieldWatermark()
                .scaleEffect(0.9)
                .offset(x: -170, y: 110)
            HStack(spacing: 12) {
                BrandMark(height: 76)
                VStack(alignment: .leading, spacing: -5) {
                    Text(verbatim: "MASTER")
                    Text(verbatim: "SAT")
                }
                .appDisplayFont(34)
                .tracking(-0.5)
                .foregroundStyle(.white)
                .dynamicTypeSize(...DynamicTypeSize.large)
            }
            .padding(.top, markTop)
            .modifier(LogoArrival())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Master SAT")
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 34, bottomTrailingRadius: 34, style: .continuous))
    }
}

/// The first sign-in steps' compact band (mockup 03): the wordmark on the left and, when more
/// than one step is owed, "Step 1 of 3" with its dots on the right.
struct AuthCompactBand: View {
    /// (the step on show, how many are owed) — nil hides the chip.
    var step: (number: Int, total: Int)?

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                BrandMark(height: 46)
                VStack(alignment: .leading, spacing: -3) {
                    Text(verbatim: "MASTER")
                    Text(verbatim: "SAT")
                }
                .appDisplayFont(21)
                .foregroundStyle(.white)
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Master SAT")
            Spacer(minLength: 8)
            if let step {
                HStack(spacing: 8) {
                    HStack(spacing: 3) {
                        ForEach(1...step.total, id: \.self) { index in
                            Capsule()
                                .fill(Color.white.opacity(index == step.number ? 1 : 0.55))
                                .frame(width: index == step.number ? 16 : 5, height: 5)
                        }
                    }
                    Text("Step \(step.number) of \(step.total)")
                        .appFont(14, weight: .bold)
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .background(Color.white.opacity(0.14), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Step \(step.number) of \(step.total)")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity)
        .background {
            // An overlay, not a ZStack: the 270-pt shield must not make the band taller.
            ClassTabPalette.band
                .overlay(alignment: .topTrailing) { ShieldWatermark().offset(x: 120, y: -60) }
                .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 28, bottomTrailingRadius: 28, style: .continuous))
            .ignoresSafeArea(edges: .top)
        }
    }
}
