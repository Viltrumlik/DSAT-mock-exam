import SwiftUI
import MasterSATKit

/// The site's assessment board, on a phone — `/assessments`.
///
/// Found by narrowing, not by scrolling: a student with a hundred and fifty assessments could
/// not locate one on a single board. The landing view is a To-do strip — homework still open,
/// nearest deadline first — above the two subjects, English and Math; a student with only one
/// subject lands straight in its domains. A subject opens its SAT domains, and a domain opens
/// the To do / In progress / Completed board for just that domain. Each level is its own
/// page, so Back goes up one, as it does on the web; search still looks across everything.
/// The narrowing rules are in the kit (`AssessmentBoard`).
///
/// The web's three board columns become tabs, their counts on the tab bar — the same
/// information in the same order, one column at a time. One card per ASSESSMENT, not per
/// homework: a homework can bundle several.
struct AssessmentsListView: View {
    /// A domain opened straight from the landing — the one-subject case, where the landing
    /// already IS the subject.
    struct DomainRoute: Hashable {
        let subject: AssessmentSubjectKey
        let domain: String
    }

    @Environment(Session.self) private var session
    @State private var model = AssessmentBoardModel()
    @State private var showAllTodo = false
    @State private var pushedSubject: AssessmentSubjectKey?
    @State private var pushedDomain: DomainRoute?

    var body: some View {
        AssessmentBoardScaffold(model: model, loadsOnAppear: true) { actions in
            landing(actions)
        }
        .navigationDestination(item: $pushedSubject) { key in
            AssessmentsSubjectView(model: model, subject: key, toBoard: { pushedSubject = nil })
        }
        .navigationDestination(item: $pushedDomain) { route in
            AssessmentsDomainView(
                model: model,
                subject: route.subject,
                domain: route.domain,
                trail: [
                    AssessmentCrumb(label: "My assessments") { pushedDomain = nil },
                    AssessmentCrumb(label: route.domain),
                ]
            )
        }
    }

    @ViewBuilder
    private func landing(_ actions: AssessmentCardActions) -> some View {
        let board = model.board
        VStack(alignment: .leading, spacing: 30) {
            AssessmentTodoSection(
                entries: board.todo(),
                showAll: $showAllTodo,
                actions: actions
            )
            if let sole = board.soleSubject {
                AssessmentDomainGrid(subject: sole) { name in
                    pushedDomain = DomainRoute(subject: sole.key, domain: name)
                }
            } else if board.subjects.count > 1 {
                AssessmentSubjectGrid(subjects: board.subjects) { pushedSubject = $0 }
            } else {
                // Nothing this page could place under a subject: show it all rather than hide it.
                AssessmentColumns(entries: board.entries, actions: actions)
            }
        }
    }
}

/// Maths blue, English purple — the board's own rule, so two pieces of work are told apart
/// before either title is read.
enum SubjectStyle {
    struct Style {
        let label: String
        let icon: String
        let tone: Color
    }

    static func of(_ subject: String?) -> Style {
        switch AssessmentSubjectKey.of(subject) {
        case .math:
            return Style(label: "Math", icon: "function", tone: Theme.accent)
        case .english:
            return Style(label: "English", icon: "text.book.closed.fill", tone: Theme.subjectEnglish)
        case nil:
            let raw = subject ?? ""
            return Style(
                label: raw.isEmpty ? "General" : raw.humanisedSubject,
                icon: "square.and.pencil",
                tone: Theme.accent
            )
        }
    }

    static func of(_ key: AssessmentSubjectKey) -> Style { of(key.rawValue) }
}

/// The site's search input: a rounded field with the glyph inside it.
struct SearchField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textLabel)
            TextField(placeholder, text: $text, prompt: Text(verbatim: placeholder))
                .font(.system(size: 14, weight: .semibold))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textLabel)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.card))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
    }
}

/// The board's third button: outlined, not filled, because reviewing finished work is not
/// the action a student came for.
struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .heavy))
            .foregroundStyle(Theme.accent)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(configuration.isPressed ? Theme.accentSoft : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Theme.accent, lineWidth: 1.5)
            )
    }
}

/// `Int` is not `Identifiable`, and both the runner and the review sheet key off an
/// attempt id. Rather than wrapping each one in its own box, make the id itself usable.
extension Int: @retroactive Identifiable {
    public var id: Int { self }
}
