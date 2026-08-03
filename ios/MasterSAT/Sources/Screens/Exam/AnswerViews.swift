import SwiftUI
import MasterSATKit

/// The A/B/C/D list, with cross-out.
struct ChoiceListView: View {
    let question: ExamQuestion
    let selected: String?
    let eliminated: Set<String>
    let onSelect: (String) -> Void
    let onEliminate: (String) -> Void

    var body: some View {
        VStack(spacing: 10) {
            ForEach(question.orderedOptionKeys, id: \.self) { key in
                if let option = question.options?[key] {
                    ChoiceRow(
                        letter: key,
                        option: option,
                        isSelected: selected == key,
                        isEliminated: eliminated.contains(key),
                        onSelect: { onSelect(key) },
                        onEliminate: { onEliminate(key) }
                    )
                }
            }
        }
    }
}

struct ChoiceRow: View {
    let letter: String
    let option: QuestionOption
    let isSelected: Bool
    let isEliminated: Bool
    let onSelect: () -> Void
    let onEliminate: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onSelect) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle()
                            .strokeBorder(isSelected ? Theme.accent : Color.secondary.opacity(0.5), lineWidth: 2)
                            .background(Circle().fill(isSelected ? Theme.accent : .clear))
                        Text(letter)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(isSelected ? .white : .secondary)
                    }
                    .frame(width: 30, height: 30)

                    VStack(alignment: .leading, spacing: 6) {
                        if !option.text.isEmpty {
                            RichText(html: option.text)
                        }
                        if let image = option.image, let url = URL(string: image) {
                            AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: {
                                ProgressView()
                            }
                            .frame(maxHeight: 220)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .buttonStyle(.plain)

            Button(action: onEliminate) {
                Image(systemName: isEliminated ? "arrow.uturn.backward" : "strikethrough")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isEliminated ? "Undo cross out \(letter)" : "Cross out \(letter)")
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isSelected ? Theme.accent.opacity(0.08) : Color(.secondarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(isSelected ? Theme.accent : .clear, lineWidth: 1.5)
        )
        // Crossing out dims the row rather than hiding it — the student is narrowing the
        // field, not deleting an option, and they can always change their mind.
        .opacity(isEliminated ? 0.45 : 1)
        .overlay(alignment: .center) {
            if isEliminated {
                Rectangle().frame(height: 1).foregroundStyle(.secondary).padding(.horizontal, 12)
            }
        }
    }
}

/// Student-produced response (grid-in): the answer is typed, not chosen.
struct SprInputView: View {
    let value: String
    let onChange: (String) -> Void

    @State private var text: String = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Your answer", text: $text)
                .font(.title3.monospacedDigit())
                .textFieldStyle(.roundedBorder)
                // A grid-in answer can be negative, a decimal, or a fraction like 3/4, so
                // the keyboard has to carry "-" and "/" — a plain number pad would make
                // some correct answers untypeable.
                .keyboardType(.numbersAndPunctuation)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($isFocused)
                .onChange(of: text) { _, new in onChange(new) }
                .onAppear { text = value }
                // A new question reuses this view; without this the previous answer would
                // be shown against it.
                .onChange(of: value) { _, new in if new != text { text = new } }

            Text("Enter a number, a decimal, or a fraction such as 3/4.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { isFocused = false }
            }
        }
    }
}

/// The grid of every question in the module: what is answered, what is flagged, where you
/// are. This is the "Check your work" surface.
struct QuestionNavigatorView: View {
    @Bindable var runner: ExamRunner
    let onSelect: (Int) -> Void

    private let columns = [GridItem(.adaptive(minimum: 52), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(runner.questions.enumerated()), id: \.element.id) { index, question in
                        let key = String(question.id)
                        let isAnswered = runner.answers[key]?.isEmpty == false
                        Button { onSelect(index) } label: {
                            Text("\(index + 1)")
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .frame(width: 52, height: 44)
                                .background(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .fill(isAnswered ? Theme.accent.opacity(0.15) : Color(.secondarySystemBackground))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(
                                            index == runner.currentIndex ? Theme.accent : .clear,
                                            lineWidth: 2
                                        )
                                )
                                .overlay(alignment: .topTrailing) {
                                    if runner.flagged.contains(question.id) {
                                        Image(systemName: "flag.fill")
                                            .font(.system(size: 9))
                                            .foregroundStyle(Theme.flagged)
                                            .padding(4)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .navigationTitle("\(runner.answeredCount) of \(runner.questions.count) answered")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
