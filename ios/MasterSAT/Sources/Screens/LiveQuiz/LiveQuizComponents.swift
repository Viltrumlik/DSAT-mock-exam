import SwiftUI
import MasterSATKit

// Pieces the live-quiz screens share — the web's `features/liveQuiz/ui.tsx`. Prefixed
// `LiveQuiz` so they cannot collide with anything another screen defines.

/// Podium colours, the web's `MEDAL` (`ui.tsx`): the text colour of places 1–3.
enum LiveQuizMedal {
    static func colour(forPlace place: Int) -> Color? {
        switch place {
        case 1: return Color(red: 0xd4 / 255, green: 0xa0 / 255, blue: 0x17 / 255)
        case 2: return Color(red: 0x9a / 255, green: 0xa4 / 255, blue: 0xb2 / 255)
        case 3: return Color(red: 0xb4 / 255, green: 0x70 / 255, blue: 0x3a / 255)
        default: return nil
        }
    }
}

/// A whole-screen state — lobby, "Get ready…", paused, the end — as the web's centred card:
/// an icon, a headline, a sentence, and whatever belongs under them.
struct LiveQuizStateCard<Extra: View>: View {
    let icon: String
    let title: String
    var message: String?
    var tone: Color = Theme.accent
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        VStack(spacing: 14) {
            IconTile(systemName: icon, tone: tone, size: 60)
            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 19, weight: .heavy))
                    .tracking(-0.2)
                if let message {
                    Text(message)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            extra()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .cardStyle(padding: 20)
    }
}

extension LiveQuizStateCard where Extra == EmptyView {
    init(icon: String, title: String, message: String? = nil, tone: Color = Theme.accent) {
        self.init(icon: icon, title: title, message: message, tone: tone, extra: { EmptyView() })
    }
}

/// The web's `ConnectionBanner`: a drop is temporary and says it is retrying.
struct LiveQuizConnectionBanner: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 14, weight: .semibold))
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            ProgressView().controlSize(.small)
        }
        .foregroundStyle(Theme.warning)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.warningSoft))
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
                    .font(.system(size: 16, weight: .heavy))
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(isSelected ? Theme.accent : Theme.card))
                    .overlay(Circle().stroke(isSelected ? Theme.accent : Theme.separator, lineWidth: 2))
                    .foregroundStyle(isSelected ? .white : Color.primary)
                Text(choice.text)
                    .font(.system(size: 17, weight: .semibold))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(isSelected ? Theme.accentSoft : Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(isSelected ? Theme.accent : Theme.separator.opacity(0.9), lineWidth: 2)
            )
            // A button's label is only hit-testable where it draws.
            .contentShape(Rectangle())
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
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
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

    private func standingRow(_ row: LiveQuizParticipant, place: Int, mine: Bool) -> some View {
        HStack(spacing: 12) {
            Text(ScoreText.string(place))
                .font(.system(size: 15, weight: .heavy).monospacedDigit())
                .foregroundStyle(LiveQuizMedal.colour(forPlace: place) ?? Theme.textSecondary)
                .frame(width: 30)
            HStack(spacing: 6) {
                Text(row.displayName.isEmpty ? "Student" : row.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                if mine {
                    Text("you")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            Spacer(minLength: 8)
            Text(ScoreText.string(row.score))
                .font(.system(size: 15, weight: .heavy).monospacedDigit())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(mine ? Theme.accentSoft : Theme.surface2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(mine ? Theme.accent.opacity(0.3) : .clear, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// The web's `ScoreCard`: a label over a number — Place, Score, Correct.
struct LiveQuizStatBox: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(.system(size: 24, weight: .heavy).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.surface2))
        .accessibilityElement(children: .combine)
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
