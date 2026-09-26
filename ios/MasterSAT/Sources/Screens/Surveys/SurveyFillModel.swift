import SwiftUI
import MasterSATKit

/// Everything the survey form holds while a student fills it in.
///
/// The rules (what is shown, what opens a note, what is still missing, what is sent) are
/// `SurveyRules` in the kit, tested there. This class is the part that has to live with
/// time: the draft that arrives after the form, the autosave, the one-shot submit.
@MainActor
@Observable
final class SurveyFillModel {
    enum Phase: Equatable {
        case loading
        /// 404/403 — closed, unpublished, or not aimed at this student. The server does not
        /// say which, on purpose.
        case unavailable
        /// Anything else: the survey may be perfectly fine behind a dropped connection.
        case failed
        case loaded
    }

    let surveyId: Int
    private let api: SurveysAPI

    private(set) var phase: Phase = .loading
    private(set) var survey: Survey?
    private(set) var answers: [Int: SurveyAnswer] = [:]
    private(set) var followUps: [Int: String] = [:]
    /// "Anonymously" in the anonymity card. Only sent where the survey allows it.
    var anonymous = false

    /// Set when Submit is pressed with something missing. Until then the form stays quiet:
    /// marking a question before the student has reached it is nagging, not help.
    private(set) var showMissing = false
    private(set) var isSubmitting = false
    private(set) var submitError: String?
    private(set) var done = false
    /// What the SERVER recorded, not what was asked for.
    private(set) var doneAnonymously = false

    // The draft. Bookkeeping only — nothing on screen reads it.
    @ObservationIgnored private var draftRestored = false
    @ObservationIgnored private var changedBeforeRestore = false
    @ObservationIgnored private var draftTask: Task<Void, Never>?
    @ObservationIgnored private var lastSaved: SurveyPayload?

    init(surveyId: Int, api: SurveysAPI) {
        self.surveyId = surveyId
        self.api = api
    }

    // MARK: - Derived

    var visibleQuestions: [SurveyQuestion] {
        SurveyRules.visibleQuestions(survey?.questions ?? [], answers: answers)
    }

    var gaps: [SurveyGap] {
        SurveyRules.gaps(in: survey?.questions ?? [], answers: answers, followUps: followUps)
    }

    func gap(for question: SurveyQuestion) -> SurveyGap.Kind? {
        guard showMissing else { return nil }
        return gaps.first { $0.questionId == question.id }?.kind
    }

    func wantsFollowUp(_ question: SurveyQuestion) -> Bool {
        SurveyRules.wantsFollowUp(question, answer: answers[question.id])
    }

    // MARK: - Editing

    func answer(for question: SurveyQuestion) -> SurveyAnswer? { answers[question.id] }

    func setAnswer(_ value: SurveyAnswer?, for question: SurveyQuestion) {
        guard answers[question.id] != value else { return }
        answers[question.id] = value
        edited()
    }

    func note(for question: SurveyQuestion) -> String { followUps[question.id] ?? "" }

    func setNote(_ text: String, for question: SurveyQuestion) {
        guard followUps[question.id] ?? "" != text else { return }
        followUps[question.id] = text.isEmpty ? nil : text
        edited()
    }

    private func edited() {
        if draftRestored {
            scheduleDraftSave()
        } else {
            changedBeforeRestore = true
        }
    }

    // MARK: - Loading

    func load() async {
        if survey == nil { phase = .loading }
        // Fetched side by side, as the web does; the draft only matters once the form is here.
        let api = self.api
        let id = surveyId
        async let fetchedDraft = api.draft(surveyId: id)
        do {
            survey = try await api.survey(id: id)
            phase = .loaded
        } catch {
            if survey == nil { phase = Self.isUnavailable(error) ? .unavailable : .failed }
            _ = try? await fetchedDraft
            return
        }
        if let draft = try? await fetchedDraft { restore(draft) }
        // A failed draft fetch leaves the autosave OFF, as on the web: saving before the
        // stored copy is known would overwrite it with an emptier form.
    }

    /// Lay the saved draft onto the form, ONCE. What the student typed while it was loading
    /// wins over the older stored copy.
    private func restore(_ draft: SurveyDraft) {
        guard !draftRestored, let survey else { return }
        let merged = SurveyRules.merge(
            draft: draft, into: answers, followUps: followUps, questions: survey.questions
        )
        answers = merged.answers
        followUps = merged.followUps
        draftRestored = true
        if changedBeforeRestore {
            scheduleDraftSave()
        } else {
            // Nothing new since the server's copy; the next edit is the next save.
            lastSaved = SurveyRules.draft(survey.questions, answers: answers, followUps: followUps)
        }
    }

    // MARK: - Autosave

    /// 1.2 seconds after the last change, like the web.
    private func scheduleDraftSave() {
        guard survey?.isOpen == true, !done else { return }
        draftTask?.cancel()
        draftTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1200))
            guard !Task.isCancelled else { return }
            await self?.saveDraft()
        }
    }

    /// Leaving the screen or the app: send what the debounce was still holding, now, rather
    /// than lose the last second of typing.
    func flushDraft() {
        guard let pending = draftTask else { return }
        pending.cancel()
        draftTask = nil
        Task { await saveDraft() }
    }

    private func saveDraft() async {
        guard let survey, draftRestored, survey.isOpen, !done, !isSubmitting else { return }
        let payload = SurveyRules.draft(survey.questions, answers: answers, followUps: followUps)
        guard payload != lastSaved else { return }
        do {
            try await api.saveDraft(surveyId: survey.id, payload)
            lastSaved = payload
        } catch {
            // Deliberately silent: the draft is a safety net under the form, not the form,
            // and everything is still here on screen. A real problem surfaces at Submit.
        }
    }

    // MARK: - Submitting

    /// Hand the answers in. Returns the gap to take the student to when something is still
    /// missing — Submit is never disabled for that, because a dead button explains nothing.
    func submit() async -> SurveyGap? {
        guard let survey, !isSubmitting, !done else { return nil }
        if let first = gaps.first {
            showMissing = true
            return first
        }
        isSubmitting = true
        submitError = nil
        draftTask?.cancel()
        draftTask = nil
        defer { isSubmitting = false }

        let payload = SurveyRules.submission(survey.questions, answers: answers, followUps: followUps)
        do {
            let result = try await api.respond(
                surveyId: survey.id, payload, anonymous: anonymous && survey.allowAnonymous
            )
            doneAnonymously = result.isAnonymous
            done = true
        } catch {
            // One shot: never retried on its own. But the answers may have landed before the
            // connection dropped — ask the server before telling the student it failed.
            if let fresh = try? await api.survey(id: survey.id), fresh.alreadyCompleted {
                self.survey = fresh
                done = true
                return nil
            }
            submitError = CommunityErrorText.message(error, fallback: "Those answers weren't accepted.")
        }
        return nil
    }

    private static func isUnavailable(_ error: Error) -> Bool {
        switch error as? APIError {
        case .http(let status, _)?: return status == 404
        case .forbidden?: return true
        default: return false
        }
    }
}
