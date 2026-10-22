import SwiftUI
import MasterSATKit

/// The site's "Set your target score" popover, as a sheet. Opened from the Me sheet's goal panel.
struct GoalSheet: View {
    @State var english: Int
    @State var math: Int
    let onSave: (Int, Int) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 22) {
                Text("Each section is 200–800.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)

                slider("Math score", value: $math)
                slider("English score", value: $english)

                HStack {
                    Text("Overall").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    Text(ScoreText.string(english + math))
                        .font(.system(size: 18, weight: .heavy).monospacedDigit())
                        .foregroundStyle(Theme.accent)
                    Spacer()
                }

                Spacer()

                Button {
                    saving = true
                    Task {
                        await onSave(english, math)
                        saving = false
                        dismiss()
                    }
                } label: {
                    Text(saving ? "Saving…" : "Save goal")
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: true))
                .disabled(saving)
            }
            .padding(20)
            .background(Theme.background)
            .navigationTitle("Set your target score")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func slider(_ label: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(label).font(.system(size: 14, weight: .semibold))
                Text(ScoreText.string(value.wrappedValue))
                    .font(.system(size: 14, weight: .heavy).monospacedDigit())
            }
            Slider(
                value: Binding(get: { Double(value.wrappedValue) }, set: { value.wrappedValue = Int($0) }),
                in: 200...800,
                step: 10
            )
            .tint(Theme.accent)
        }
    }
}
