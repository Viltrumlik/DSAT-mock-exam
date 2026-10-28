import SwiftUI
import MasterSATKit

// Pieces the live-quiz screens share — the web's `features/liveQuiz/ui.tsx`. Prefixed
// `LiveQuiz` so they cannot collide with anything another screen defines.

/// A whole-screen state — lobby, "Get ready…", paused, the end — as the web's centred card:
/// an icon, a headline, a sentence, and whatever belongs under them.
struct LiveQuizStateCard<Extra: View>: View {
    let icon: String
    let title: String
    var message: String?
    var tone: Color = NewLook.blue
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        VStack(spacing: 14) {
            IconTile(systemName: icon, tone: tone, size: 60)
            VStack(spacing: 6) {
                Text(title)
                    .appDisplayFont(21)
                    .tracking(-0.3)
                    .foregroundStyle(NewLook.ink)
                if let message {
                    Text(message)
                        .appFont(15, weight: .medium)
                        .foregroundStyle(NewLook.ink4)
                }
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            extra()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .newLookCard(padding: 20, radius: 24)
    }
}

extension LiveQuizStateCard where Extra == EmptyView {
    init(icon: String, title: String, message: String? = nil, tone: Color = NewLook.blue) {
        self.init(icon: icon, title: title, message: message, tone: tone, extra: { EmptyView() })
    }
}

/// The web's `ConnectionBanner`: a drop is temporary and says it is retrying.
struct LiveQuizConnectionBanner: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash")
                .appFont(14, weight: .semibold)
                .accessibilityHidden(true)
            Text(text)
                .appFont(14, weight: .semibold)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            ProgressView().controlSize(.small)
        }
        .foregroundStyle(NewLook.orangeInk)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(NewLook.orange50, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// One option: a lettered circle and the text, the runner's `AssessmentChoiceRow` shape at
/// the size a thumb wants in a hurry. Plain text rather than the runner's web view: these are
/// words and definitions, and a web view per option would flash in on a timed question.
struct LiveQuizChoiceRow: View {
    let choice: LiveQuizChoice
    let isSelected: Bool
    let isDisabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 14) {
                Text(choice.id)
                    .appFont(17, weight: .heavy)
                    .capDynamicType()
                    .foregroundStyle(isSelected ? .white : NewLook.blueText)
                    .frame(width: 40, height: 40)
                    .background(isSelected ? NewLook.blue : NewLook.blue50, in: Circle())
                Text(choice.text)
                    .appFont(18, weight: .semibold)
                    .foregroundStyle(NewLook.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            // The kit's `.opt` at a thumb's size: white, a 2-pt blue ring once picked — the only
            // state while the question is open; right and wrong wait for the results step.
            .background {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(isSelected ? NewLook.optionPicked : NewLook.card)
                    .newLookShadow(.tile)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(isSelected ? NewLook.blue : .clear, lineWidth: 2)
            )
            // A button's label is only hit-testable where it draws.
            .contentShape(Rectangle())
            .animation(Motion.focus, value: isSelected)
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled && !isSelected ? 0.6 : 1)
        .accessibilityLabel("Option \(choice.id), \(choice.text)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The web's `LeaderboardList`: place, name, score — the student's own row picked out.
struct LiveQuizStandingsList: View {
    let rows: [LiveQuizParticipant]
    let isMe: (LiveQuizParticipant) -> Bool
    var limit: Int?

    var body: some View {
        let places = LiveQuizGame.places(for: rows)
        let shown = Array(rows.enumerated().prefix(limit ?? rows.count))
        if shown.isEmpty {
            Text("Nobody has scored yet.")
                .appFont(14, weight: .medium)
                .foregroundStyle(NewLook.ink4)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
        } else {
            VStack(spacing: 6) {
                ForEach(shown, id: \.element.id) { index, row in
                    standingRow(row, place: places[index], mine: isMe(row))
                }
            }
        }
    }

    /// The kit's `.lrow`: a rank pill, the name, the score; the student's own row in blue.
    private func standingRow(_ row: LiveQuizParticipant, place: Int, mine: Bool) -> some View {
        HStack(spacing: 12) {
            RankPill(rank: place)
            HStack(spacing: 6) {
                Text(row.displayName.isEmpty ? "Student" : row.displayName)
                    .appFont(15, weight: .semibold)
                    .foregroundStyle(NewLook.ink)
                    .lineLimit(1)
                if mine {
                    Text("you")
                        .appFont(12, weight: .bold)
                        .foregroundStyle(NewLook.blueText)
                }
            }
            Spacer(minLength: 8)
            Text(ScoreText.string(row.score))
                .appFont(15, weight: .heavy, monospacedDigits: true)
                .foregroundStyle(NewLook.ink)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(mine ? NewLook.blue50 : NewLook.sheet, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// The web's `ScoreCard`: a label over a number — Place, Score, Correct.
struct LiveQuizStatBox: View {
    let label: String
    let value: String

    var body: some View {
        NewLookCountBox(value: value, label: label)
    }
}

/// The sentence for a failed request, never the log line.
enum LiveQuizErrorText {
    static func message(_ error: Error, fallback: String) -> String {
        if let refusal = error as? LiveQuizRefusal { return refusal.errorDescription ?? fallback }
        if let error = error as? APIError {
            switch error {
            case .transport:
                return "Couldn't reach MasterSAT. Check your connection and try again."
            case .decoding:
                return fallback
            default:
                return error.errorDescription ?? fallback
            }
        }
        return fallback
    }
}
