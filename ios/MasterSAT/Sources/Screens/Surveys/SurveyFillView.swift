import SwiftUI
import MasterSATKit

/// One survey — the site's `/surveys/{id}`.
///
/// Mount as `SurveyFillView(surveyId:)`. `cameFromList` is set by `SurveysListView`, so
/// "Back to surveys" goes back rather than stacking a second list on top of the first.
struct SurveyFillView: View {
    let surveyId: Int
    var cameFromList = false

    @Environment(Session.self) private var session
    @State private var model: SurveyFillModel?

    var body: some View {
        Group {
            if surveyId <= 0 {
                // Checked before anything is fetched: an id that cannot name a survey must not
                // sit on a spinner that never resolves.
                ScrollView {
                    CommunityStateCard(
                        icon: "list.clipboard",
                        title: "That isn't a survey link",
                        message: "The address is missing a survey number. The surveys page lists everything you can answer."
                    ) {
                        SurveysBackButton(cameFromList: cameFromList)
                    }
                    .padding(16)
                }
            } else if let model {
                SurveyFillScreen(model: model, cameFromList: cameFromList)
            } else {
                SurveyFillSkeleton()
            }
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard surveyId > 0, model == nil else { return }
            let created = SurveyFillModel(surveyId: surveyId, api: SurveysAPI(client: session.client))
            model = created
            await created.load()
        }
    }
}

/// The form and its states, once there is a model to read.
private struct SurveyFillScreen: View {
    let model: SurveyFillModel
    let cameFromList: Bool

    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focus: SurveyFocus?
    @AccessibilityFocusState private var spokenGap: Int?

    var body: some View {
        content
            // Leaving the screen, or the app, sends what the autosave was still holding.
            .onDisappear { model.flushDraft() }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { model.flushDraft() }
            }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            SurveyFillSkeleton()
        case .unavailable:
            page {
                CommunityStateCard(
                    icon: "list.clipboard",
                    title: "Survey not available",
                    message: "It may have closed, or it isn't published yet."
                ) {
                    SurveysBackButton(cameFromList: cameFromList)
                }
            }
        case .failed:
            // Not "not available": the survey may be sitting there perfectly fine behind a
            // dropped connection, and saying otherwise states as fact something we do not know.
            page {
                CommunityStateCard(
                    icon: "wifi.exclamationmark",
                    title: "That didn't load",
                    message: "Nothing has been lost — the survey just couldn't be fetched.",
                    tone: Theme.warning
                ) {
                    Button("Try again") { Task { await model.load() } }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
        case .loaded:
            if let survey = model.survey {
                if survey.questions.isEmpty {
                    // Gated on ALL the questions, never the visible ones: a form whose later
                    // questions are waiting on an answer is not a form with no questions.
                    page {
                        CommunityStateCard(
                            icon: "list.clipboard",
                            title: "This survey has no questions yet",
                            message: "Nothing to answer here at the moment. It will appear on your surveys page once there is."
                        ) {
                            SurveysBackButton(cameFromList: cameFromList)
                        }
                    }
                } else if model.done || survey.alreadyCompleted {
                    page { thanks(survey) }
                } else {
                    form(survey)
                }
            }
        }
    }

    private func page<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            content().padding(16)
        }
    }

    // MARK: - Done

    private func thanks(_ survey: Survey) -> some View {
        CommunityStateCard(
            icon: "checkmark.circle.fill",
            title: "Thanks — your answers are in.",
            // Only when it paid something. A survey worth 0 is a legitimate thing an admin can
            // create, and telling that student "your points have been added" would be untrue.
            message: survey.pointsAward > 0 ? "Your points have been added." : nil,
            tone: Theme.success
        ) {
            VStack(spacing: 14) {
                if model.done && model.doneAnonymously {
                    Label("Sent without your name", systemImage: "eye.slash")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.surface2))
                }
                SurveysBackButton(cameFromList: cameFromList)
            }
        }
    }

    // MARK: - The form

    private func form(_ survey: Survey) -> some View {
        let visible = model.visibleQuestions
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HeroHeader(
                        eyebrow: "Survey",
                        eyebrowIcon: "bubble.left.and.text.bubble.right",
                        title: survey.title,
                        blurb: survey.description.isEmpty ? nil : survey.description,
                        tiles: heroTiles(survey, visibleCount: visible.count)
                    )

                    if let image = survey.imageURL {
                        CommunityRemoteImage(urlString: image)
                            .frame(maxWidth: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                            .accessibilityLabel(survey.description.isEmpty ? survey.title : survey.description)
                            .cardStyle(padding: 10)
                    }

                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, question in
                        SurveyQuestionCard(
                            model: model,
                            question: question,
                            number: index + 1,
                            focus: $focus,
                            spokenGap: $spokenGap
                        )
                        .id(question.id)
                    }

                    if survey.allowAnonymous { anonymityCard }

                    // Beside the button that caused it: an alert at the top of a twenty-question
                    // form is one the student pressing Submit at the bottom never sees.
                    if let error = model.submitError { submitError(error) }

                    footer(proxy: proxy)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focus = nil }
                }
            }
        }
    }

    /// "Questions" counts what is on screen now; "Earns you" appears only when it does.
    private func heroTiles(_ survey: Survey, visibleCount: Int) -> [HeroTile] {
        var tiles = [HeroTile("Questions", icon: "list.number", value: visibleCount)]
        if survey.pointsAward > 0 {
            tiles.append(HeroTile("Earns you", icon: "star.fill", value: "Points"))
        }
        return tiles
    }

    private var anonymityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("How should this be sent?")
                .font(.system(size: 15, weight: .bold))
            SurveyAnonymityChoice(
                icon: "person.crop.circle",
                label: "With my name",
                hint: "Staff can see who wrote it.",
                selected: !model.anonymous
            ) { model.anonymous = false }
            SurveyAnonymityChoice(
                icon: "eye.slash",
                label: "Anonymously",
                hint: "Your name is kept off the results.",
                selected: model.anonymous
            ) { model.anonymous = true }
        }
        .cardStyle()
    }

    private func submitError(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Theme.danger)
            VStack(alignment: .leading, spacing: 3) {
                Text("Couldn't send your answers")
                    .font(.system(size: 14, weight: .bold))
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .fill(Theme.dangerSoft)
        )
    }

    private func footer(proxy: ScrollViewProxy) -> some View {
        let missing = model.gaps.count
        return HStack(spacing: 12) {
            Text(missing == 0
                 ? "Ready to send."
                 : "\(CommunityFormat.count(missing, "question", "questions")) still to answer.")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            // Deliberately NOT disabled while something is missing. A dead button explains
            // nothing; pressing it takes the student to the first gap and marks it. Disabled
            // only while sending, because a submit is one shot.
            Button {
                Task { await submit(proxy) }
            } label: {
                HStack(spacing: 7) {
                    if model.isSubmitting {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "list.clipboard")
                    }
                    Text(model.isSubmitting ? "Sending…" : "Submit")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isSubmitting)
        }
        .cardStyle()
    }

    private func submit(_ proxy: ScrollViewProxy) async {
        focus = nil
        guard let gap = await model.submit() else { return }
        withAnimation(.easeInOut(duration: 0.3)) {
            proxy.scrollTo(gap.questionId, anchor: .center)
        }
        // Scrolling alone tells a VoiceOver or keyboard user nothing: hand them the gap too.
        try? await Task.sleep(for: .milliseconds(350))
        if gap.kind == .note {
            focus = .note(gap.questionId)
        } else if let question = model.visibleQuestions.first(where: { $0.id == gap.questionId }),
                  [.shortText, .longText].contains(question.type) {
            focus = .answer(gap.questionId)
        }
        spokenGap = gap.questionId
    }
}

// MARK: - One question

private struct SurveyQuestionCard: View {
    let model: SurveyFillModel
    let question: SurveyQuestion
    let number: Int
    var focus: FocusState<SurveyFocus?>.Binding
    var spokenGap: AccessibilityFocusState<Int?>.Binding

    var body: some View {
        let gap = model.gap(for: question)
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 14) {
                // The homework detail numbers its steps exactly this way.
                Text(verbatim: String(number))
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(gap == nil ? Theme.accent : Theme.danger)
                    .frame(width: 30, height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(gap == nil ? Theme.accentSoft : Theme.dangerSoft)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    (Text(question.prompt)
                        + (question.isRequired ? Text(" *").foregroundStyle(Theme.danger) : Text("")))
                        .font(.system(size: 16, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(question.isRequired ? "\(question.prompt), required" : question.prompt)
                    if !question.helpText.isEmpty {
                        Text(question.helpText)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }

            if let image = question.imageURL {
                CommunityRemoteImage(urlString: image)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    .accessibilityLabel(question.helpText.isEmpty ? question.prompt : question.helpText)
            }

            SurveyQuestionControl(
                question: question,
                answer: model.answer(for: question),
                onChange: { model.setAnswer($0, for: question) },
                focus: focus
            )

            if model.wantsFollowUp(question) { followUp }

            if let gap {
                Text(gap == .answer
                     ? "This one still needs an answer."
                     : "Please add a short note to go with your answer.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                    .accessibilityFocused(spokenGap, equals: question.id)
            }
        }
        .cardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(Theme.danger.opacity(gap == nil ? 0 : 0.6), lineWidth: 1.5)
        )
    }

    /// Opened by the answer above it. The placeholder is the author's own question, and it
    /// clears the moment the student types.
    private var followUp: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 5) {
                Text(question.followUpRequired ? "Please tell us more" : "Anything you'd like to add?")
                    .font(.system(size: 13, weight: .bold))
                if question.followUpRequired {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.danger)
                } else {
                    Text("Optional")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityElement(children: .combine)

            TextField(
                "",
                text: Binding(
                    get: { model.note(for: question) },
                    set: { model.setNote($0, for: question) }
                ),
                prompt: question.followUpPlaceholder.isEmpty ? nil : Text(verbatim: question.followUpPlaceholder),
                axis: .vertical
            )
            .lineLimit(3...8)
            .focused(focus, equals: .note(question.id))
            .communityField(highlighted: focus.wrappedValue == .note(question.id))
            .accessibilityLabel(question.followUpRequired ? "Please tell us more" : "Anything you'd like to add? Optional")
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(Theme.surface2)
        )
    }
}

// MARK: - Pieces

private struct SurveyAnonymityChoice: View {
    let icon: String
    let label: String
    let hint: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(selected ? Theme.accent : Theme.textSecondary)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.primary)
                    Text(hint)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(selected ? Theme.accent : Theme.textLabel)
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
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// "Back to surveys": back where the student came from when that was the list, otherwise
/// to the list itself.
struct SurveysBackButton: View {
    let cameFromList: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if cameFromList {
            Button("Back to surveys") { dismiss() }
                .buttonStyle(SecondaryButtonStyle())
        } else {
            NavigationLink {
                SurveysListView()
            } label: {
                Text("Back to surveys")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }
}

private struct SurveyFillSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(Theme.surface2)
                    .frame(height: 170)
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .fill(Theme.surface2)
                        .frame(height: 140)
                }
            }
            .padding(16)
        }
        .accessibilityLabel("Loading the survey")
    }
}
