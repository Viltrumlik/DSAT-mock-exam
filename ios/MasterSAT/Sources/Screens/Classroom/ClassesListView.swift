import SwiftUI
import MasterSATKit

/// The classes a student belongs to — the site's `/classes`: a headline with "Join class",
/// the All · English · Math filter, and one card per class.
struct ClassesListView: View {
    @Environment(Session.self) private var session
    @State private var classrooms: [Classroom] = []
    @State private var isLoading = true
    @State private var hasLoaded = false
    @State private var loadError: String?
    @State private var filter: ClassroomSubjectFilter = .all
    @State private var joining = false
    @State private var joinedName: String?

    private func count(_ filter: ClassroomSubjectFilter) -> Int {
        classrooms.filter(filter.matches).count
    }

    private var shown: [Classroom] { classrooms.filter(filter.matches) }

    private var tabs: [PillTabs<ClassroomSubjectFilter>.Item] {
        ClassroomSubjectFilter.allCases.map { item in
            .init(
                tab: item,
                title: item.title,
                icon: item == .math ? "function" : item == .english ? "book.closed" : "square.grid.2x2",
                count: count(item)
            )
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    PageTitle("Classes")
                    Button { joining = true } label: {
                        Label("Join class", systemImage: "person.badge.plus")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .fixedSize()
                }

                if let joinedName {
                    Label("You joined \(joinedName).", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.success)
                }

                if isLoading && !hasLoaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 50)
                } else if let loadError, classrooms.isEmpty {
                    // A failed load is never "no classes yet".
                    ClassroomErrorState(
                        title: "Couldn't load your classes",
                        message: "Something went wrong on our end. Check your connection and try again."
                    ) { await load() }
                    .accessibilityHint(loadError)
                } else if classrooms.isEmpty {
                    VStack(spacing: 12) {
                        DashedEmpty(title: "No classes yet", hint: "Have a class code? Join now to get started.")
                        Button("Join with a code") { joining = true }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                } else {
                    if loadError != nil {
                        Label("Could not refresh just now — this is the last list we had.", systemImage: "exclamationmark.triangle")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    PillTabs(items: tabs, selection: $filter)
                    if shown.isEmpty {
                        DashedEmpty(title: "No \(filter.title) classes")
                    }
                    VStack(spacing: 12) {
                        ForEach(shown) { room in
                            NavigationLink {
                                ClassroomDetailView(classroom: room)
                            } label: {
                                ClassroomCard(classroom: room)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $joining) {
            JoinClassSheet { room in
                joinedName = room.name
                Task { await load() }
            }
            .presentationDetents([.medium])
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        loadError = nil
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            classrooms = try await session.classrooms.classrooms()
        } catch let error as APIError {
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// One class on the list: the subject band, the name, "days · time · room", and the
/// head-count of students — never of staff.
struct ClassroomCard: View {
    let classroom: Classroom

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                IconTile(
                    systemName: classroom.isMath ? "function" : "book.closed.fill",
                    tone: classroom.isMath ? Theme.accent : Theme.subjectEnglish,
                    size: 44
                )
                VStack(alignment: .leading, spacing: 4) {
                    Text(classroom.name)
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text(classroom.cardScheduleLine)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                if let count = classroom.headCount {
                    Label("\(ScoreText.string(count)) \(count == 1 ? "student" : "students")", systemImage: "person.2")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Text("Open").font(.system(size: 13, weight: .bold))
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                }
                .foregroundStyle(Theme.accent)
            }
        }
        .cardStyle(padding: 16)
        .overlay(alignment: .top) {
            // The subject band along the top edge, as on the site's class card.
            Rectangle()
                .fill(classroom.isMath ? Theme.accent : Theme.subjectEnglish)
                .frame(height: 4)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .contentShape(Rectangle())
    }
}

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
/// Never an empty state — "nothing here" is only for a successful empty answer.
struct ClassroomErrorState: View {
    let title: String
    let message: String
    let retry: @MainActor () async -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 26))
                .foregroundStyle(Theme.warning)
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 16)
    }
}
