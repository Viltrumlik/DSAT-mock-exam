import SwiftUI
import MasterSATKit

// What the Class tab, the class page and the Me sheet share: joining a class, a person's
// photo, and a failed load.

/// "Join a class" — the site's dialog, as a sheet.
///
/// The code is the only way back into a class a student was removed from, so a wrong one
/// fails loudly with the server's own sentence.
struct JoinClassSheet: View {
    let onJoined: (Classroom) -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var isJoining = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { code.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Join a class").font(.system(size: 20, weight: .heavy))
                Text("Enter the code your teacher gave you.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Class code")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
                TextField("", text: $code, prompt: Text(verbatim: "e.g. 7QX2KP"))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 17, weight: .bold, design: .monospaced))
                    .focused($focused)
                    .submitLabel(.join)
                    .onSubmit(join)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                            .stroke(error == nil ? Theme.separator : Theme.danger, lineWidth: 1)
                    )
                if let error {
                    Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                }
            }

            HStack(spacing: 10) {
                Button("Cancel") { dismiss() }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                Button(action: join) {
                    if isJoining { ProgressView().tint(.white).frame(maxWidth: .infinity) }
                    else { Text("Join class").frame(maxWidth: .infinity) }
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(trimmed.isEmpty || isJoining)
            }
        }
        .padding(20)
        .background(Theme.background)
        .onAppear { focused = true }
    }

    @MainActor
    private func join() {
        guard !trimmed.isEmpty, !isJoining else { return }
        isJoining = true
        error = nil
        let code = trimmed.uppercased()
        Task {
            defer { isJoining = false }
            do {
                let room = try await session.classrooms.join(code: code)
                onJoined(room)
                dismiss()
            } catch let failure as APIError {
                error = failure.errorDescription
            } catch let failure {
                error = failure.localizedDescription
            }
        }
    }
}

/// A person's photo, or their initials.
///
/// The rule the platform follows everywhere: if the name is hidden, the photo hides with
/// it — a face identifies someone more directly than a name does.
struct Avatar: View {
    let url: String?
    let name: String
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Theme.accent.opacity(0.15))
            Text(shortInitials)
                .font(.system(size: size * 0.38, weight: .bold))
                .foregroundStyle(Theme.accent)
        }
    }

    private var shortInitials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }
}

/// A load that failed, in the site's two lines: what could not be loaded, and what to do.
/// Never an empty state — "nothing here" is only for a successful empty answer. The compact
/// `ErrorState`: the Me sheet can show three of these at once, one per panel.
struct ClassroomErrorState: View {
    let title: String
    let message: String
    let retry: @MainActor () async -> Void

    var body: some View {
        ErrorState(title: title, message: message, style: .inline, retry: retry)
    }
}
