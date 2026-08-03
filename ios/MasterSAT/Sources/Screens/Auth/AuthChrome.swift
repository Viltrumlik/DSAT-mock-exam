import SwiftUI
import MasterSATKit

/// The brand panel and the form controls the site's `/login` and `/register` share.
///
/// Both pages are the same page with a different form in it, which is why the panel, the
/// fields and the alert live here rather than being written twice.

// MARK: - Brand

/// The two blues the auth panel is painted with, `linear-gradient(160deg,#2a68c0,#1f4d9a)`.
///
/// Fixed, not `Theme.accent`: the accent shifts to indigo in dark mode so it survives a dark
/// surface, but this panel *is* the surface and carries white text either way. A student
/// switching their phone to dark mode should still meet the same blue they see on the site.
enum Brand {
    static let top = Color(red: 0.165, green: 0.408, blue: 0.753)
    static let bottom = Color(red: 0.122, green: 0.302, blue: 0.604)

    /// 160° in CSS terms: 0° points up, so the ramp runs down and slightly right.
    static let panel = LinearGradient(
        colors: [top, bottom],
        startPoint: UnitPoint(x: 0.329, y: 0.030),
        endPoint: UnitPoint(x: 0.671, y: 0.970)
    )

    /// What the platform promises, in the site's own words and order.
    static let promises: [(icon: String, text: String)] = [
        ("chart.line.uptrend.xyaxis", "Live readiness and score trends"),
        ("sparkles", "Classroom assessments and monthly midterm exams"),
        ("checkmark.shield.fill", "Real Exam environment"),
    ]
}

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

/// The lockup: mark beside the word, as the site draws it in the panel's top corner.
struct BrandLockup: View {
    var height: CGFloat = 44
    var fontSize: CGFloat = 21

    var body: some View {
        HStack(spacing: 11) {
            BrandMark(height: height)
            Text("MasterSAT")
                .font(.system(size: fontSize, weight: .heavy))
                .tracking(-0.4)
                .foregroundStyle(.white)
        }
    }
}

/// The site's `<aside class="authbrand">`.
///
/// `compact` is the phone: the panel cannot sit *beside* anything, so it becomes the header
/// band. The promises come off in that layout when the form behind them is long — five
/// fields and a pitch do not both fit above the fold, and the fields are what the student
/// came for.
struct BrandPanel: View {
    let headline: String
    var blurb: String?
    var showsPromises: Bool = true
    var compact: Bool = false
    /// How far down the lockup has to start to clear the status bar. Passed in rather than
    /// hard-coded, because a Dynamic Island and a notch do not agree on the number.
    var topInset: CGFloat = 48

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandLockup(height: compact ? 38 : 48, fontSize: compact ? 19 : 21)

            Text(headline)
                .font(.system(size: compact ? 27 : 40, weight: .heavy))
                .tracking(compact ? -0.7 : -1.1)
                .lineSpacing(compact ? 0 : 2)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, compact ? 18 : 40)

            if let blurb {
                Text(blurb)
                    .font(.system(size: compact ? 14 : 16, weight: .medium))
                    .foregroundStyle(.white.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, compact ? 10 : 18)
            }

            if showsPromises {
                VStack(alignment: .leading, spacing: compact ? 11 : 16) {
                    ForEach(Brand.promises, id: \.text) { promise in
                        PromiseRow(icon: promise.icon, text: promise.text, compact: compact)
                    }
                }
                .padding(.top, compact ? 18 : 34)
            }

            if !compact {
                Spacer(minLength: 24)
                Text("© \(ScoreText.string(Calendar.current.component(.year, from: Date()))) MasterSAT Center")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: compact ? nil : .infinity, alignment: .topLeading)
        .padding(.horizontal, compact ? 22 : 44)
        .padding(.top, topInset)
        .padding(.bottom, compact ? 30 : 48)
        .background(Brand.panel)
        .overlay { FloatingShapes(compact: compact) }
        .clipped()
    }
}

private struct PromiseRow: View {
    let icon: String
    let text: String
    let compact: Bool

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(.white.opacity(0.15))
                .frame(width: compact ? 28 : 32, height: compact ? 28 : 32)
                .overlay(
                    Image(systemName: icon)
                        .font(.system(size: compact ? 13 : 15, weight: .semibold))
                        .foregroundStyle(.white)
                )
            Text(text)
                .font(.system(size: compact ? 14 : 15, weight: .medium))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The panel's drifting shapes — the web's `dz-floatA…D` keyframes.
///
/// Decoration, and nothing but: `allowsHitTesting(false)` because an overlay in SwiftUI is
/// hit-testable by default, and a 280pt circle over a form eats every tap under it.
private struct FloatingShapes: View {
    let compact: Bool
    @State private var drifting = false

    var body: some View {
        GeometryReader { geometry in
            let w = geometry.size.width
            let h = geometry.size.height
            ZStack {
                Circle()
                    .fill(.white.opacity(0.10))
                    .frame(width: 280, height: 280)
                    .position(x: w + 30, y: -20)
                    .offset(y: drifting ? 14 : -14)
                    .animation(.easeInOut(duration: 14).repeatForever(autoreverses: true), value: drifting)

                RoundedRectangle(cornerRadius: 44, style: .continuous)
                    .fill(.white.opacity(0.08))
                    .frame(width: 200, height: 200)
                    .position(x: w - 60, y: h + 40)
                    .offset(x: drifting ? -12 : 12)
                    .animation(.easeInOut(duration: 16).repeatForever(autoreverses: true), value: drifting)

                Circle()
                    .stroke(.white.opacity(0.11), lineWidth: 18)
                    .frame(width: 150, height: 150)
                    .position(x: -20, y: h - 60)
                    .offset(y: drifting ? -16 : 16)
                    .animation(.easeInOut(duration: 13).repeatForever(autoreverses: true), value: drifting)

                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.white.opacity(0.07))
                    .frame(width: 60, height: 60)
                    .position(x: w - (compact ? 70 : 120), y: compact ? 130 : 90)
                    .offset(x: drifting ? 10 : -10, y: drifting ? -8 : 8)
                    .animation(.easeInOut(duration: 15).repeatForever(autoreverses: true), value: drifting)

                // The brightest of the shapes, and the only one that reads as an object
                // rather than a wash — so it stays out of the band, where at this size it
                // lands squarely on the headline.
                if !compact {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(.white.opacity(0.30))
                        .frame(width: 16, height: 16)
                        // Below the promises, above the copyright — the one stretch of the
                        // panel that is always empty, whichever page is showing.
                        .position(x: 40, y: h * 0.62)
                        .offset(y: drifting ? 12 : -12)
                        .animation(.easeInOut(duration: 11).repeatForever(autoreverses: true), value: drifting)
                }
            }
        }
        .allowsHitTesting(false)
        .onAppear { drifting = true }
    }
}

// MARK: - Form controls

/// The web's `Field` + `Input`: a bold label, a bordered box, an icon inside it on the left.
struct AuthField<Accessory: View>: View {
    let label: String
    var icon: String?
    @ViewBuilder let content: () -> Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
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
                    .stroke(Theme.separator.opacity(0.7), lineWidth: 1)
            )
        }
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
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(colour)
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .font(.system(size: 13, weight: .semibold))
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
struct PasswordField: View {
    let label: String
    @Binding var text: String
    var textContentType: UITextContentType = .password
    var submitLabel: SubmitLabel = .go
    @FocusState.Binding var focus: AuthFocus?
    let field: AuthFocus
    let onSubmit: () -> Void

    @State private var revealed = false

    var body: some View {
        AuthField(label: label, icon: "lock") {
            Group {
                if revealed {
                    TextField(text: $text, prompt: Text(verbatim: "••••••••")) { Text(label) }
                } else {
                    SecureField(text: $text, prompt: Text(verbatim: "••••••••")) { Text(label) }
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
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textLabel)
                    .frame(width: 30, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(revealed ? "Hide password" : "Show password")
        }
    }
}

/// Which box the keyboard is in. Shared by both forms so `PasswordField` can name a field
/// on either of them.
enum AuthFocus: Hashable {
    case email, password, firstName, lastName, username
}

/// The sentence to show when a sign-in or a sign-up fails, and whether trying the same
/// thing again could work. A port of the web's `classifyLoginError`.
enum AuthErrorCopy {
    static func classify(_ error: Error) -> (message: String, retryable: Bool) {
        guard let api = error as? APIError else {
            return (error.localizedDescription, false)
        }
        switch api {
        case .transport:
            return ("Cannot connect to the server. Check your internet connection and try again.", true)
        case .unauthorized:
            // On this screen a 401 is a wrong password, not an expired session — the
            // student has no session yet. `APIError`'s own wording is written for the
            // other case and would send them looking for a problem they do not have.
            return ("The email or password you entered is incorrect.", false)
        case .forbidden(let detail, _):
            // The server's own words: a teacher signing in here is told to use the teacher
            // portal, and a frozen account is told it is frozen.
            return (detail.isEmpty ? "Your account has been restricted. Contact support." : detail, false)
        case .validation(let detail, _, _):
            return (detail.isEmpty ? "Please check the details you entered." : detail, false)
        case .http(let status, let detail) where status == 429:
            return (detail.isEmpty ? "Too many attempts. Please wait a minute before trying again." : detail, false)
        case .http(let status, let detail) where status >= 500:
            return (detail.isEmpty ? "Server error. Please try again in a moment." : detail, true)
        case .http(_, let detail):
            return (detail.isEmpty ? "Something went wrong. Please try again." : detail, true)
        case .conflict(let detail):
            return (detail.isEmpty ? "Something went wrong. Please try again." : detail, false)
        case .decoding, .notAuthenticated:
            return (api.errorDescription ?? "Something went wrong. Please try again.", false)
        }
    }
}
