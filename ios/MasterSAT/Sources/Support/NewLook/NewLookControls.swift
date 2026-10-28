import SwiftUI
import MasterSATKit

// The kit's choosing controls and list furniture: the segmented control (`.seg`), the filter
// chips (`.filters`), the rank pill (`.rank`) and the initials disc (`.ava`).

/// `.seg`: a grey track with a white thumb under the chosen option. The thumb slides in ≤ 250 ms,
/// and snaps under Reduce Motion — the same views either way.
struct NewLookSegmented<Value: Hashable>: View {
    let options: [(value: Value, title: String)]
    @Binding var selection: Value

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var thumb

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { option in
                let on = option.value == selection
                Button {
                    selection = option.value
                } label: {
                    Text(option.title)
                        .appFont(14, weight: on ? .bold : .semibold)
                        .foregroundStyle(on ? NewLook.ink : NewLook.ink4)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if on {
                                Capsule()
                                    .fill(NewLook.card)
                                    .shadow(color: .black.opacity(0.08), radius: 4, y: 2)
                                    .matchedGeometryEffect(id: "thumb", in: thumb)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(NewLook.ink.opacity(0.06), in: Capsule())
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: selection)
    }
}

/// `.filters`: a row of white chips; the chosen one is ink. Scrolls sideways when it runs out
/// of room.
struct NewLookFilterChips<Value: Hashable>: View {
    struct Option {
        let value: Value
        let title: String
        var systemImage: String?
        var count: Int?
        var tone: Color = NewLook.blueText
    }

    let options: [Option]
    @Binding var selection: Value

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options, id: \.value) { option in
                    let on = option.value == selection
                    Button {
                        selection = option.value
                    } label: {
                        HStack(spacing: 6) {
                            if let systemImage = option.systemImage {
                                Image(systemName: systemImage)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(on ? .white : option.tone)
                            }
                            Text(option.title)
                                .appFont(14, weight: .bold)
                            if let count = option.count {
                                Text(String(count))
                                    .appFont(12, weight: .heavy)
                                    .foregroundStyle(on ? Color.white.opacity(0.7) : NewLook.blueText)
                            }
                        }
                        .foregroundStyle(on ? Color.white : NewLook.ink)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 34)
                        .background(on ? NewLook.ink : NewLook.card, in: Capsule())
                        .shadow(color: .black.opacity(on ? 0 : 0.08), radius: 1, y: 1)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
        }
        .padding(.horizontal, -16)
        .noBarClearanceInRow()
    }
}

/// `.rank`: a board place in a pill — gold, silver and copper for the first three.
struct RankPill: View {
    let rank: Int

    private var colors: (fill: Color, text: Color)? {
        switch rank {
        case 1: (NewLook.gold50, NewLook.goldInk)
        case 2: (NewLook.silver50, NewLook.silverInk)
        case 3: (NewLook.copper50, NewLook.copperInk)
        default: nil
        }
    }

    var body: some View {
        Text(String(rank))
            .appFont(14, weight: .heavy, monospacedDigits: true)
            .foregroundStyle(colors?.text ?? NewLook.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(width: 30, height: 28)
            .background(colors?.fill ?? .clear, in: Capsule())
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// `.ava`: initials in a tinted disc; six tints, picked by the student's id so a name keeps its
/// colour. The student's own disc is blue.
struct InitialsDisc: View {
    let initials: String
    var seed: Int = 0
    var isMe = false
    var size: CGFloat = 34

    private static let tints: [(fill: UInt32, ink: UInt32)] = [
        (0xFCE3EC, 0xA8174F), (0xDCF2E3, 0x17703D), (0xEAE4FB, 0x553BAE),
        (0xFFEFD3, 0x9A5800), (0xDAF1F3, 0x16707C), (0xFFE4DE, 0xAE3D27),
    ]

    var body: some View {
        let tint = Self.tints[abs(seed) % Self.tints.count]
        Text(initials)
            .appFont(12, weight: .heavy)
            .foregroundStyle(isMe ? Color.white : Color(RGB(hex: tint.ink)))
            .frame(width: size, height: size)
            .background(isMe ? NewLook.blue : Color(RGB(hex: tint.fill)), in: Circle())
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityHidden(true)
    }
}
