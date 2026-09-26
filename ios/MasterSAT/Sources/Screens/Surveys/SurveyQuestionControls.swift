import SwiftUI
import MasterSATKit

/// Which field has the keyboard, so Submit can hand it to the first gap.
enum SurveyFocus: Hashable {
    case answer(Int)
    case note(Int)
}

/// The right control for a question's type — the site's `SurveyQuestionField`.
///
/// Every control reports `nil` for "no answer". An untouched slider, an unpicked date, an
/// empty box: none of them is a silent zero or today.
struct SurveyQuestionControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onChange: (SurveyAnswer?) -> Void
    var focus: FocusState<SurveyFocus?>.Binding

    var body: some View {
        switch question.type {
        case .shortText, .other:
            // A type this build does not know is a text box, as on the web.
            SurveyTextControl(question: question, answer: answer, multiline: false, onChange: onChange, focus: focus)
        case .longText:
            SurveyTextControl(question: question, answer: answer, multiline: true, onChange: onChange, focus: focus)
        case .date:
            SurveyDateControl(question: question, answer: answer, onChange: onChange)
        case .scale:
            SurveyScaleControl(question: question, answer: answer, onChange: onChange)
        case .rating:
            SurveyRatingControl(question: question, answer: answer, onChange: onChange)
        case .singleChoice:
            SurveySingleChoiceControl(question: question, answer: answer, onChange: onChange)
        case .multiChoice:
            SurveyMultiChoiceControl(question: question, answer: answer, onChange: onChange)
        }
    }
}

// MARK: - Text

private struct SurveyTextControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let multiline: Bool
    let onChange: (SurveyAnswer?) -> Void
    var focus: FocusState<SurveyFocus?>.Binding

    private var text: Binding<String> {
        Binding(
            get: {
                switch answer {
                case .text(let raw)?: return raw
                case .number(let value)?: return String(value)
                case .choices(let list)?: return list.joined(separator: ", ")
                case nil: return ""
                }
            },
            // Kept exactly as typed; trimming happens once, when it is sent.
            set: { onChange($0.isEmpty ? nil : .text($0)) }
        )
    }

    var body: some View {
        Group {
            if multiline {
                TextField("", text: text, axis: .vertical)
                    .lineLimit(4...10)
            } else {
                TextField("", text: text)
                    .submitLabel(.done)
            }
        }
        .accessibilityLabel(question.prompt)
        .focused(focus, equals: .answer(question.id))
        .communityField(highlighted: focus.wrappedValue == .answer(question.id))
    }
}

// MARK: - Date

/// A day, picked on a calendar. Nothing is recorded until the student presses Done — a
/// date field that quietly filled itself with today would be an answer nobody gave.
private struct SurveyDateControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onChange: (SurveyAnswer?) -> Void

    @State private var picking = false
    @State private var pending = Date()

    private var chosen: Date? {
        if case .text(let raw)? = answer { return SurveyDate.date(from: raw) }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                pending = chosen ?? Date()
                picking = true
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "calendar")
                        .foregroundStyle(Theme.accent)
                    Text(chosen.map { $0.formatted(date: .long, time: .omitted) } ?? "Choose a date")
                        .foregroundStyle(chosen == nil ? Theme.textSecondary : Color.primary)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textLabel)
                }
                .communityField()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(question.prompt)
            .accessibilityValue(chosen.map { $0.formatted(date: .long, time: .omitted) } ?? "Not answered yet")

            if chosen != nil && !question.isRequired {
                SurveyClearButton { onChange(nil) }
            }
        }
        .sheet(isPresented: $picking) {
            NavigationStack {
                DatePicker("", selection: $pending, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    .tint(Theme.accent)
                    .padding(.horizontal, 16)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .navigationTitle("Choose a date")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { picking = false }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") {
                                onChange(.text(SurveyDate.string(from: pending)))
                                picking = false
                            }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
    }
}

// MARK: - Scale

/// A short row of numbers (1–5 by default), one tap each.
private struct SurveyScaleControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onChange: (SurveyAnswer?) -> Void

    private var picked: Int? {
        if case .number(let value)? = answer { return value }
        return nil
    }

    private var steps: [Int] {
        question.scaleMax >= question.scaleMin ? Array(question.scaleMin...question.scaleMax) : []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 44, maximum: 52), spacing: 8)],
                alignment: .leading,
                spacing: 8
            ) {
                ForEach(steps, id: \.self) { step in
                    let on = picked == step
                    Button { onChange(.number(step)) } label: {
                        Text(verbatim: String(step))
                            .font(.system(size: 15, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(on ? Color.white : Color.primary)
                            .frame(width: 44, height: 44)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                    .fill(on ? Theme.accent : Theme.card)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                    .stroke(on ? Theme.accent : Theme.separator.opacity(0.8), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            // The same way out the slider and the radio group have: an optional question
            // that cannot be un-answered is not optional.
            if picked != nil && !question.isRequired {
                SurveyClearButton { onChange(nil) }
            }
        }
    }
}

// MARK: - Rating (the recommendation slider)

/// A dragged slider with a written sentence at each end.
///
/// It stays UNANSWERED until touched: parked at the bottom, drawn faded, and reported as
/// nothing — not as a silent 0, which on a 0–10 recommendation question is the worst score
/// there is. Letting go of the thumb commits the number under it even when it never moved,
/// or a student who means 0 could never record it.
private struct SurveyRatingControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onChange: (SurveyAnswer?) -> Void

    /// The thumb while a drag is under way.
    @State private var thumb: Double?

    private var lower: Int { question.scaleMin }
    /// Guarded: a scale whose top is not above its bottom would be an empty slider range.
    private var upper: Int { max(question.scaleMax, question.scaleMin + 1) }
    private var steps: [Int] { Array(lower...upper) }

    private var picked: Int? {
        if case .number(let value)? = answer { return value }
        return nil
    }

    private var position: Double { thumb ?? Double(picked ?? lower) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            numberRow

            Slider(
                value: Binding(
                    get: { position },
                    set: { value in
                        thumb = value
                        onChange(.number(Int(value.rounded())))
                    }
                ),
                in: Double(lower)...Double(upper),
                step: 1,
                onEditingChanged: { editing in
                    guard !editing else { return }
                    onChange(.number(Int(position.rounded())))
                    thumb = nil
                }
            )
            .tint(picked == nil ? Theme.textLabel : Theme.accent)
            .opacity(picked == nil ? 0.7 : 1)
            .accessibilityLabel(question.prompt)
            .accessibilityValue(spokenValue)

            if !question.scaleLowLabel.isEmpty || !question.scaleHighLabel.isEmpty {
                HStack(alignment: .top, spacing: 16) {
                    Text(question.scaleLowLabel)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(question.scaleHighLabel)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            }

            if picked == nil {
                Text("Drag the slider to choose a number.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            } else if !question.isRequired {
                // A slider is the easiest control in the form to nudge while scrolling.
                SurveyClearButton { onChange(nil) }
            }
        }
    }

    /// The numbers above the track, each sitting over the thumb position it names.
    private var numberRow: some View {
        GeometryReader { geometry in
            // The system thumb is ~28pt wide, so its centre travels 14pt in from each end.
            let inset: CGFloat = 14
            let span = max(geometry.size.width - inset * 2, 1)
            let gaps = CGFloat(max(steps.count - 1, 1))
            ForEach(Array(steps.enumerated()), id: \.element) { index, step in
                Text(verbatim: String(step))
                    .font(.system(size: 13, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(picked == step ? Theme.accent : Theme.textSecondary)
                    .frame(width: 26, height: 22)
                    .contentShape(Rectangle())
                    .onTapGesture { onChange(.number(step)) }
                    .position(x: inset + span * CGFloat(index) / gaps, y: 11)
            }
        }
        .frame(height: 22)
        .accessibilityHidden(true)
    }

    /// Names the END the student is at, not just the number — "7" alone does not say which
    /// end means what.
    private var spokenValue: String {
        guard let picked else { return "Not answered yet" }
        var parts = [String(picked)]
        if picked == question.scaleMin, !question.scaleLowLabel.isEmpty { parts.append(question.scaleLowLabel) }
        if picked == question.scaleMax, !question.scaleHighLabel.isEmpty { parts.append(question.scaleHighLabel) }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Choices

private struct SurveySingleChoiceControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onChange: (SurveyAnswer?) -> Void

    private var picked: String? {
        if case .text(let raw)? = answer { return raw }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                SurveyChoiceRow(text: option, selected: picked == option, multiple: false) {
                    onChange(.text(option))
                }
            }
            // A radio group has no native way back to "nothing", so an optional one needs an
            // explicit way out.
            if picked != nil && !question.isRequired {
                SurveyClearButton { onChange(nil) }
            }
        }
    }
}

/// Checkboxes, with "Pick up to N" when the author capped them. At the cap the unpicked
/// boxes go disabled rather than letting the student tick one more and be refused at
/// Submit — the server still enforces it; this is the courtesy, not the rule.
private struct SurveyMultiChoiceControl: View {
    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onChange: (SurveyAnswer?) -> Void

    private var picked: [String] {
        switch answer {
        case .choices(let list)?: return list
        case .text(let raw)?: return [raw]
        default: return []
        }
    }

    var body: some View {
        let cap = question.maxSelections
        let atCap = cap > 0 && picked.count >= cap
        VStack(alignment: .leading, spacing: 7) {
            if cap > 0 {
                (Text("Pick up to \(ScoreText.string(cap))")
                    + (atCap
                        ? Text(" — that's \(ScoreText.string(cap)), unpick one to change").foregroundStyle(Theme.accent)
                        : Text("")))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                let on = picked.contains(option)
                SurveyChoiceRow(text: option, selected: on, multiple: true, disabled: atCap && !on) {
                    let next = on ? picked.filter { $0 != option } : picked + [option]
                    onChange(next.isEmpty ? nil : .choices(next))
                }
            }
        }
    }
}

private struct SurveyChoiceRow: View {
    let text: String
    let selected: Bool
    let multiple: Bool
    var disabled = false
    let action: () -> Void

    private var glyph: String {
        if multiple { return selected ? "checkmark.square.fill" : "square" }
        return selected ? "largecircle.fill.circle" : "circle"
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: glyph)
                    .font(.system(size: 19))
                    .foregroundStyle(selected ? Theme.accent : Theme.textLabel)
                Text(text)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.primary)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(selected ? Theme.accentSoft : Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(selected ? Theme.accent : Theme.separator.opacity(0.7), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// "Clear my answer" — the web's small underlined way back to unanswered.
struct SurveyClearButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Clear my answer")
                .font(.system(size: 12, weight: .semibold))
                .underline()
                .foregroundStyle(Theme.textSecondary)
        }
        .buttonStyle(.plain)
    }
}
