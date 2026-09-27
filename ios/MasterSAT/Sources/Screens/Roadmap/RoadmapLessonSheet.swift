import SwiftUI
import MasterSATKit

/// The lesson a circle was tapped on, with its button already worked out.
struct RoadmapSheetItem: Identifiable {
    let id: String
    let lesson: RoadmapLesson
    let action: RoadmapLessonAction
}

/// Where the roadmap goes once the sheet has closed.
enum RoadmapPush {
    case reading(deliveryId: Int)
    case homework(AssignmentListing)
}

/// "{n}. {title}", its tags, and the one thing to do next — the web's popup under a circle.
///
/// The homework is looked up here, before the sheet closes, so a failure is said where the
/// student pressed the button rather than on a page they were never taken to.
struct RoadmapLessonSheet: View {
    let item: RoadmapSheetItem
    let student: StudentAPI
    let onPush: (RoadmapPush) -> Void

    @State private var isOpening = false
    @State private var openError: String?
    @State private var height: CGFloat = 240
    /// The homework lookup, so closing the sheet can cancel it.
    @State private var opening: Task<Void, Never>?

    private var lesson: RoadmapLesson { item.lesson }
    private var action: RoadmapLessonAction { item.action }

    private var title: String { "\(lesson.lessonNumber). \(lesson.title)" }

    private var tags: [String] {
        var tags: [String] = []
        if lesson.isMidterm { tags.append("Midterm") }
        if let reading = RoadmapRules.readingTag(for: lesson) { tags.append(reading) }
        if let date = lesson.scheduledDate { tags.append(LearnMoreDateText.shortDay(date)) }
        tags.append(action.tag)
        return tags
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.system(size: 19, weight: .heavy, design: .rounded))
                .fixedSize(horizontal: false, vertical: true)

            FlowLayout(spacing: 6) {
                ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                    Text(tag)
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Theme.surface2))
                }
            }

            Button {
                opening = Task { await perform() }
            } label: {
                HStack(spacing: 8) {
                    if isOpening {
                        ProgressView().tint(buttonText)
                    }
                    Text(action.label)
                }
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .foregroundStyle(buttonText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(buttonFill))
                .contentShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
            }
            .buttonStyle(RoadmapPressStyle())
            .disabled(!action.isEnabled || isOpening)
            .accessibilityHint(action.isEnabled ? "" : "Not open yet")

            if let openError {
                VStack(alignment: .leading, spacing: 2) {
                    Text("That didn’t open")
                        .font(.system(size: 13, weight: .bold))
                    Text(openError)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(Theme.danger)
            }

            if let readAgain = action.readAgainDeliveryId {
                Button("Read it again") { onPush(.reading(deliveryId: readAgain)) }
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .disabled(isOpening)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { newHeight in
            height = newHeight
        }
        .presentationDetents([.height(max(height, 180))])
        .presentationDragIndicator(.visible)
        .onDisappear { opening?.cancel() }
    }

    /// The web's button colours, with a disabled button greyed out whatever its state —
    /// a green button that does nothing reads as broken.
    private var buttonFill: Color {
        guard action.isEnabled else { return Theme.surface2 }
        switch action.tone {
        case .green: return Theme.success
        case .brand: return Theme.accent
        case .gold: return Theme.amber
        case .grey: return Theme.surface2
        }
    }

    private var buttonText: Color {
        action.isEnabled && action.tone != .grey ? .white : Theme.textSecondary
    }

    @MainActor
    private func perform() async {
        guard let target = action.target, !isOpening else { return }
        switch target {
        case .reading(let deliveryId):
            onPush(.reading(deliveryId: deliveryId))
        case .homework(_, let assignmentId):
            isOpening = true
            openError = nil
            defer { isOpening = false }
            do {
                let listing = try await RoadmapHomework.listing(assignmentId: assignmentId, student: student)
                onPush(.homework(listing))
            } catch {
                if Task.isCancelled { return }
                openError = learnMoreMessage(error)
            }
        }
    }
}
