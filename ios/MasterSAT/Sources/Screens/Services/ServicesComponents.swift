import SwiftUI
import MasterSATKit

// Pieces the Services and Support screens share. Feature-prefixed so they cannot collide with
// anything another screen defines.

/// Where a request stands. Every list on these screens designs all of them: a failure is
/// said out loud with a way to retry, and "nothing here" is only ever said about a list that
/// actually loaded empty.
enum ServicesLoadState<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
}

enum ServicesError {
    /// The sentence to show for a failed request — the server's own where it sent one, which
    /// for a refused booking is written for the student ("That slot is full.").
    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}

/// A load that failed, said as the site says it: what happened, that nothing is lost, and
/// a way to try again. The technical reason sits underneath, small, for whoever is helping.
struct ServicesNotice: View {
    let title: String
    var message: String?
    var detail: String?
    let retry: @MainActor () async -> Void

    @State private var retrying = false

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 24))
                .foregroundStyle(Theme.warning)
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .multilineTextAlignment(.center)
            if let message {
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textLabel)
                    .multilineTextAlignment(.center)
            }
            Button {
                Task {
                    retrying = true
                    await retry()
                    retrying = false
                }
            } label: {
                if retrying {
                    ProgressView().frame(minWidth: 80)
                } else {
                    Text("Try again")
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(retrying)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .cardStyle(padding: 18)
    }
}

/// A person's photo, or their initials.
struct ServicesAvatar: View {
    let url: String?
    let name: String
    var size: CGFloat = 40

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
        .accessibilityHidden(true)
    }

    private var initials: some View {
        ZStack {
            Circle().fill(Theme.accent.opacity(0.15))
            Text(verbatim: letters)
                .font(.system(size: size * 0.38, weight: .bold))
                .foregroundStyle(Theme.accent)
        }
    }

    private var letters: String {
        let parts = name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }
        return parts.isEmpty ? "?" : parts.joined().uppercased()
    }
}

/// A small tinted capsule in any colour — `Chip` covers the semantic tones, this covers the
/// services' own (violet has no semantic twin).
struct ServicesTonePill: View {
    let text: String
    var icon: String?
    let tone: Color

    var body: some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 11, weight: .bold)) }
            Text(text).font(.system(size: 12.5, weight: .bold))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(Capsule().fill(tone.opacity(0.13)))
    }
}

/// Chips that wrap onto the next line rather than running off the edge: test centres, test
/// dates, cancellation reasons. A chip wider than the whole line is given the line and wraps
/// its own text.
struct ServicesFlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for item in row.items {
                subviews[item.index].place(
                    at: CGPoint(x: x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(item.size)
                )
                x += item.size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var items: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            var size = subviews[index].sizeThatFits(.unspecified)
            if size.width > width {
                size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            }
            if !row.items.isEmpty && row.width + spacing + size.width > width {
                rows.append(row)
                row = Row()
            }
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append((index, size))
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}

/// A checkbox, drawn as one: the SAT checklist's agreement is a box a student ticks, not a
/// switch they flip.
struct ServicesCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 21, weight: .medium))
                    .foregroundStyle(configuration.isOn ? Theme.accent : Theme.textSecondary)
                configuration.label
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.primary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 1)
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous).fill(Theme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(configuration.isOn ? Theme.accent : Theme.separator.opacity(0.6),
                            lineWidth: configuration.isOn ? 1.5 : 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(configuration.isOn ? "Ticked" : "Not ticked")
    }
}

/// The two buttons at the foot of a sheet, kept on screen however long the sheet's content
/// is — a confirm button scrolled out of reach under a keyboard is a sheet that cannot finish.
struct ServicesSheetButtons: View {
    let secondaryTitle: String
    let primaryTitle: String
    var primaryTone: Color = Theme.accent
    let primaryEnabled: Bool
    let inFlight: Bool
    let secondary: () -> Void
    let primary: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(secondaryTitle, action: secondary)
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                .disabled(inFlight)
            Button(action: primary) {
                ZStack {
                    // The title keeps its width while the spinner shows, so the button does
                    // not jump under the student's thumb.
                    Text(primaryTitle).opacity(inFlight ? 0 : 1)
                    if inFlight { ProgressView().tint(.white) }
                }
            }
            .buttonStyle(PrimaryButtonStyle(tone: primaryTone, fullWidth: true))
            // `PrimaryButtonStyle` draws the same when disabled; say it with opacity.
            .opacity(primaryEnabled || inFlight ? 1 : 0.45)
            .disabled(!primaryEnabled || inFlight)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.bar)
    }
}
