import SwiftUI
import MasterSATKit

// The profile's pieces of the house design — the web's `features/profile/profileUi.tsx`:
// white panels, a tint of each thing's own colour behind its icon, and one palette for the
// three tabs so a colour means the same thing wherever it shows up.

/// The web's profile palette: primary for the student's own figures, emerald for what is
/// done, amber for strikes and what is due, sky for classes, violet for what is coming, rose
/// only for signing out.
enum ProfileTone {
    static let primary = Theme.accent
    static let emerald = Theme.success
    static let amber = Theme.warning
    static let sky = Theme.info
    /// The web's `--chart-6` (#7c3aed). The nearest purple `Theme` has is the English
    /// subject colour, which is what this borrows.
    static let violet = Theme.subjectEnglish
    static let rose = Theme.danger
}

extension View {
    /// A soft well in a tone — the web's `TONE[tone].well` behind a figure or a row.
    func profileWell(_ tone: Color, radius: CGFloat = 12, opacity: Double = 0.07) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(tone.opacity(opacity)))
    }
}

/// Small, spaced capitals over a figure — the web's `Eyebrow`.
struct ProfileEyebrow: View {
    let text: String
    var tone: Color = Theme.textSecondary

    init(_ text: String, tone: Color = Theme.textSecondary) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(verbatim: text.uppercased())
            .font(.system(size: 10.5, weight: .heavy))
            .tracking(0.95)
            .foregroundStyle(tone)
    }
}

/// A white panel with its heading: the tile, the name, one line of what it is for, and room
/// for an action — the web's `Panel` + `PanelHeader`. The action sits beside the words while
/// there is room and drops below them on a narrow screen, as it does on the web.
struct ProfilePanel<Actions: View, Content: View>: View {
    let icon: String
    let tone: Color
    let title: String
    var description: String?
    @ViewBuilder var actions: () -> Actions
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 12) {
                    heading
                    Spacer(minLength: 8)
                    actions()
                }
                VStack(alignment: .leading, spacing: 12) {
                    heading
                    HStack(spacing: 8) { actions() }
                }
            }
            content()
        }
        .cardStyle(padding: 18)
    }

    private var heading: some View {
        HStack(spacing: 12) {
            IconTile(systemName: icon, tone: tone, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(.system(size: 17, weight: .heavy))
                    .tracking(-0.2)
                    .foregroundStyle(.primary)
                if let description {
                    Text(verbatim: description)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

extension ProfilePanel where Actions == EmptyView {
    init(icon: String, tone: Color, title: String, description: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(icon: icon, tone: tone, title: title, description: description, actions: { EmptyView() }, content: content)
    }
}

/// A rounded chip: an icon and a few words in a tone. With an action it is a button — the
/// hero's amber "Confirm your email" is a thing to do, not a warning.
struct ProfileChip: View {
    let text: String
    let icon: String
    let tone: Color
    var action: (() -> Void)?

    var body: some View {
        if let action {
            Button(action: action) { chip }
                .buttonStyle(.plain)
                .contentShape(Capsule())
        } else {
            chip
        }
    }

    private var chip: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold))
            // Verbatim: an address or a phone number is not markdown, and must not become a link.
            Text(verbatim: text)
                .font(.system(size: 12.5, weight: .bold))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(Capsule().fill(tone.opacity(0.13)))
    }
}

/// Grey blocks where rows are about to be. A placeholder, never a zero.
struct ProfilePlaceholderRows: View {
    var count = 2
    var height: CGFloat = 56

    var body: some View {
        VStack(spacing: 8) {
            ForEach(0..<count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Theme.surface2)
                    .frame(height: height)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

/// A row that sits on a panel: the page's own ground colour, a hairline, rounded — the web's
/// small `quartz` rows inside a panel.
extension View {
    func profileRow() -> some View {
        self
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.background))
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}

/// Choosing the SAT date, from the dates the learning center has opened — the web's Study
/// goal radio list, as a menu. The same list Home's countdown offers (`/users/exam-dates/`),
/// saved through the same call; the current choice carries the tick.
///
/// A list that failed to load says so and offers to try again; it is never an empty menu.
struct ProfileExamDateMenu<Label: View>: View {
    let current: String?
    let options: ProfileLoad<[ExamDateOption]>
    let isSaving: Bool
    let onSelect: (String?) -> Void
    let onRetry: () -> Void
    @ViewBuilder var label: () -> Label

    private var saved: String {
        (current ?? "").trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        Menu {
            if let list = options.value {
                Picker(
                    "SAT date",
                    selection: Binding(
                        get: { saved },
                        set: { choice in onSelect(choice.isEmpty ? nil : choice) }
                    )
                ) {
                    ForEach(list) { option in
                        choice(ProfileGoal.examDateLabel(option.examDate), sub: subtitle(option))
                            .tag(option.examDate)
                    }
                    // The saved date may have dropped off the list: the server offers upcoming
                    // dates only. It stays on the menu so the tick has somewhere to be.
                    if !saved.isEmpty, !list.contains(where: { $0.examDate == saved }) {
                        choice(ProfileGoal.examDateLabel(saved), sub: "Your saved date — no longer offered")
                            .tag(saved)
                    }
                    choice("Not decided yet", sub: "Pick one when you know").tag("")
                }
                .pickerStyle(.inline)
                if list.isEmpty {
                    Text("No exam dates available yet — check back soon.")
                }
            } else if options.failed {
                Button {
                    onRetry()
                } label: {
                    SwiftUI.Label("The dates didn't load — try again", systemImage: "arrow.clockwise")
                }
            } else {
                Text("Loading the dates…")
            }
        } label: {
            label()
        }
        .disabled(isSaving)
    }

    private func choice(_ title: String, sub: String?) -> some View {
        VStack(alignment: .leading) {
            Text(verbatim: title)
            if let sub, !sub.isEmpty { Text(verbatim: sub) }
        }
    }

    /// "SAT · in 54 days" — the option's own label and how far off it is.
    private func subtitle(_ option: ExamDateOption) -> String? {
        var parts: [String] = []
        let label = option.label.trimmingCharacters(in: .whitespaces)
        if !label.isEmpty { parts.append(label) }
        if let days = ProfileGoal.daysUntil(option.examDate), days >= 0 {
            parts.append(days == 0 ? "today" : "in \(days) \(days == 1 ? "day" : "days")")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
