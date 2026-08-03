import Foundation

/// When an in-progress answer may be sent, and when it must not be.
/// Pure port of the decision half of `hooks/useAutosave.ts`.
///
/// This is the single most safety-critical rule in the app. An answer that exists only on
/// the device is an answer that grades **Omitted**, so how long we are willing to sit on
/// one *is* the whole story. What changed decides the delay:
///
///     one question, discrete choice   → 0s     (send it now; choosing is a final act)
///     one question, grid-in text      → 0.4s, capped at 1.2s from the first unsent
///                                       keystroke (coalesce typing, never hoard it)
///     flags only                      → debounce (flags are not graded)
///     many questions at once          → debounce (that is rehydration, not a student)
///
/// A flat 1.5s debounce covered every case once, which meant an answer chosen in the last
/// 1.5 seconds of a module existed *only* in the submit payload.
public struct AutosavePolicy: Sendable {

    /// Ceiling for changes that are not a single deliberate answer.
    public var debounce: TimeInterval

    /// A choice was selected or cleared: one discrete, final act — send it now.
    public static let discreteAnswerDelay: TimeInterval = 0
    /// Grid-in typing: coalesce a burst of keystrokes into one request.
    public static let textAnswerDebounce: TimeInterval = 0.4
    /// ...but never hold a typed answer longer than this, however fast they type.
    public static let textAnswerMaxWait: TimeInterval = 1.2
    /// Floor between two save requests, so rapid tapping cannot become a request storm.
    public static let minSaveInterval: TimeInterval = 0.3
    /// How soon to re-arm when the delay elapses while an earlier save is still open.
    public static let inFlightRetryDelay: TimeInterval = 0.25
    public static let maxRetries = 3

    public init(debounce: TimeInterval = 1.5) {
        self.debounce = debounce
    }

    // MARK: - Inputs

    /// Everything the decision depends on, gathered so the rule itself stays pure.
    public struct Context: Sendable {
        /// This client owns the attempt and is on a settled module. False suspends
        /// everything: it means the local answers either cannot be trusted to be newest or
        /// cannot be attributed to the live module — and `save_attempt` REPLACES the
        /// module's answer map, so writing from here would destroy real work.
        public var isEnabled: Bool
        /// The engine reports a module actually running.
        public var isAttemptActive: Bool
        /// Module id from the live snapshot.
        public var liveModuleId: Int?
        /// Module id the in-memory answers belong to.
        public var answersModuleId: Int?
        /// A module submit is in flight. Submit owns the answers from here.
        public var isSubmitting: Bool
        public var isOnline: Bool
        /// Signature the server has actually accepted for this module, if any.
        public var acceptedSignature: String?
        /// Signature of what we are about to send.
        public var pendingSignature: String
        /// Question ids whose answers differ from the server's accepted baseline.
        public var changedQuestionIds: [String]
        /// Ids answered by free text (grid-in / SPR) rather than a discrete choice.
        public var textInputQuestionIds: Set<String>
        /// When the oldest still-unsent answer change happened.
        public var dirtySince: Date?
        /// When the last save request was issued.
        public var lastIssuedAt: Date?
        public var now: Date

        public init(
            isEnabled: Bool,
            isAttemptActive: Bool,
            liveModuleId: Int?,
            answersModuleId: Int?,
            isSubmitting: Bool = false,
            isOnline: Bool = true,
            acceptedSignature: String? = nil,
            pendingSignature: String,
            changedQuestionIds: [String] = [],
            textInputQuestionIds: Set<String> = [],
            dirtySince: Date? = nil,
            lastIssuedAt: Date? = nil,
            now: Date
        ) {
            self.isEnabled = isEnabled
            self.isAttemptActive = isAttemptActive
            self.liveModuleId = liveModuleId
            self.answersModuleId = answersModuleId
            self.isSubmitting = isSubmitting
            self.isOnline = isOnline
            self.acceptedSignature = acceptedSignature
            self.pendingSignature = pendingSignature
            self.changedQuestionIds = changedQuestionIds
            self.textInputQuestionIds = textInputQuestionIds
            self.dirtySince = dirtySince
            self.lastIssuedAt = lastIssuedAt
            self.now = now
        }
    }

    // MARK: - Output

    public struct Decision: Sendable, Equatable {
        /// The local draft is written even when nothing is sent — while submitting, while
        /// offline, always. It is what recovers the work if the app is killed.
        public let shouldWriteDraft: Bool
        public let action: Action

        public enum Action: Sendable, Equatable {
            case send(after: TimeInterval)
            case stayPut(Reason)
        }

        public enum Reason: String, Sendable {
            /// A duplicate client, or mid module-transition: the answers cannot be trusted.
            case notOwner
            /// No module is running.
            case notActive
            /// The answers belong to a module the attempt has moved past.
            case moduleMismatch
            /// Submit owns the answers now. Deliberately NOT a variant of `notOwner`:
            /// a "hand-off" save racing the real submit is the exact shape of the Module 2
            /// skip incident this codebase has already lived through.
            case submitting
            /// Keep the work locally; the save is retried when connectivity returns.
            case offline
            /// The server already has this exact payload. Re-sending only churns
            /// `version_number`, which is what turns a concurrent flush into a 409 burst.
            case alreadySent
        }
    }

    // MARK: - The rule

    public func decide(_ context: Context) -> Decision {
        // Order matters and mirrors the web runner exactly: the ownership guards come
        // first, then the draft is written, and only then do the "don't send" guards run.
        guard context.isEnabled else {
            return Decision(shouldWriteDraft: false, action: .stayPut(.notOwner))
        }
        guard context.isAttemptActive else {
            return Decision(shouldWriteDraft: false, action: .stayPut(.notActive))
        }
        guard let liveModuleId = context.liveModuleId else {
            return Decision(shouldWriteDraft: false, action: .stayPut(.notActive))
        }
        guard context.answersModuleId == liveModuleId else {
            return Decision(shouldWriteDraft: false, action: .stayPut(.moduleMismatch))
        }

        // Past this point the work is always drafted, whatever we decide about the network.
        if context.isSubmitting {
            return Decision(shouldWriteDraft: true, action: .stayPut(.submitting))
        }
        if !context.isOnline {
            return Decision(shouldWriteDraft: true, action: .stayPut(.offline))
        }
        if context.acceptedSignature == context.pendingSignature {
            return Decision(shouldWriteDraft: true, action: .stayPut(.alreadySent))
        }

        return Decision(shouldWriteDraft: true, action: .send(after: delay(for: context)))
    }

    /// How long we may sit on this change.
    public func delay(for context: Context) -> TimeInterval {
        var delay: TimeInterval

        if context.changedQuestionIds.count != 1 {
            // Flags only (zero changes) or a bulk rehydrate — neither is a student
            // answering a question, and a student can only answer one at a time.
            delay = debounce
        } else if context.textInputQuestionIds.contains(context.changedQuestionIds[0]) {
            // Grid-in typing: coalesce the burst, but never past the max wait measured
            // from the first keystroke we have not sent.
            let waited = context.now.timeIntervalSince(context.dirtySince ?? context.now)
            delay = max(0, min(min(Self.textAnswerDebounce, debounce), Self.textAnswerMaxWait - waited))
        } else {
            delay = Self.discreteAnswerDelay
        }

        // Rate floor: the FIRST change is still immediate — this only spaces out the next.
        if let lastIssuedAt = context.lastIssuedAt {
            delay = max(delay, Self.minSaveInterval - context.now.timeIntervalSince(lastIssuedAt))
        }
        return max(0, delay)
    }
}

// MARK: - Payload identity

public enum AutosavePayload {

    /// Order-independent identity of a save payload, so "already sent" is exact.
    ///
    /// Encoded as JSON rather than a hand-rolled join. An earlier web version separated
    /// fields with literal control bytes — invisible in an editor and in review, and
    /// load-bearing: without a separator that cannot occur in the data,
    /// `{"3":"12"} + flagged[5]` and `{"3":"125"} + flagged[]` sign identically, so a
    /// changed answer reads as "already sent" and is dropped silently. That is the exact
    /// failure this guard exists to prevent.
    public static func signature(answers: [String: String], flagged: [Int]) -> String {
        let sortedAnswers = answers.keys.sorted().map { [$0, answers[$0]!] }
        let payload: [Any] = [sortedAnswers, flagged.sorted()]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes]),
              let string = String(data: data, encoding: .utf8) else {
            // Unreachable for [String: String] + [Int], but a signature that throws would
            // be worse than one that is merely conservative: an empty string never equals
            // a real one, so the payload is treated as unsent and gets sent.
            return UUID().uuidString
        }
        return string
    }

    /// Question ids whose answer differs between two maps (added, removed or changed).
    public static func changedAnswerIds(from previous: [String: String], to next: [String: String]) -> [String] {
        var ids = Set(previous.keys)
        ids.formUnion(next.keys)
        return ids.filter { previous[$0] != next[$0] }.sorted()
    }
}
