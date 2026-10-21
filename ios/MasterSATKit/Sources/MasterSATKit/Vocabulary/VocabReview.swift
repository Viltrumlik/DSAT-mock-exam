import Foundation

/// The Words tab's "Review today": how many words are still to master, and the one set Start
/// opens.
///
/// There is no spaced repetition on the server and no "learning" bucket — a word is new or
/// mastered — so nothing is ever "due". The count is the bank's words not yet mastered (exact,
/// per section, from the hub's own load), and Start opens the most useful set: the word
/// homework due soonest that is not mastered; else the bank section with the most words still
/// to master (Start reads it and opens its set with the most — `bestSet`); else all caught up.
/// The student's own sets are never the target: they carry no word progress, and their words
/// are bank words.
public struct VocabReview: Equatable, Sendable {
    public struct HomeworkSet: Equatable, Sendable {
        public let setId: Int
        public let title: String
        public let assignmentId: Int
        public let assignmentTitle: String
        public let dueAt: String?
        public let wordCount: Int
        /// Games still to play clean — the number the set card shows as "n/4 games".
        public let gamesLeft: Int

        public init(setId: Int, title: String, assignmentId: Int, assignmentTitle: String, dueAt: String?, wordCount: Int, gamesLeft: Int) {
            self.setId = setId
            self.title = title
            self.assignmentId = assignmentId
            self.assignmentTitle = assignmentTitle
            self.dueAt = dueAt
            self.wordCount = wordCount
            self.gamesLeft = gamesLeft
        }
    }

    public enum Next: Equatable, Sendable {
        case homework(HomeworkSet)
        case section(id: Int, title: String, wordsToMaster: Int)
        /// Every word there is to learn is mastered — a state to be proud of, not an error.
        case caughtUp
        /// Nothing published and no word homework: nothing to review yet.
        case nothingYet
    }

    public let wordsToMaster: Int
    public let wordsMastered: Int
    public let next: Next

    public init(sections: [VocabSection], homework: [VocabHomeworkGroup]) {
        var toMaster = 0
        var mastered = 0
        var richest: (id: Int, title: String, left: Int)?
        for section in sections {
            let left = max(0, section.wordCount - section.progress.mastered)
            toMaster += left
            mastered += section.progress.mastered
            if left > 0, left > (richest?.left ?? 0) {
                richest = (section.id, section.title, left)
            }
        }
        wordsToMaster = toMaster
        wordsMastered = mastered

        // Due soonest first; a passed deadline is the soonest of all; no deadline is last; the
        // server's own order breaks ties.
        var owed: [(due: Date, order: Int, set: HomeworkSet)] = []
        for group in homework {
            let due = group.dueAt.flatMap(JSONCoding.parseServerDate) ?? .distantFuture
            for set in group.sets where !set.mastery.isMastered {
                owed.append((due, owed.count, HomeworkSet(
                    setId: set.id,
                    title: set.title,
                    assignmentId: group.assignmentId,
                    assignmentTitle: group.assignmentTitle,
                    dueAt: group.dueAt,
                    wordCount: set.wordCount,
                    gamesLeft: max(0, set.mastery.totalModes - set.mastery.masteredModes)
                )))
            }
        }
        if let first = owed.min(by: { ($0.due, $0.order) < ($1.due, $1.order) }) {
            next = .homework(first.set)
        } else if let richest {
            next = .section(id: richest.id, title: richest.title, wordsToMaster: richest.left)
        } else if mastered > 0 || homework.contains(where: { !$0.sets.isEmpty }) {
            next = .caughtUp
        } else {
            next = .nothingYet
        }
    }

    /// The set in an opened section with the most words still to master; the server's order
    /// breaks ties. Nil when every word in it is mastered.
    public static func bestSet(in detail: VocabSectionDetail) -> VocabSectionDetail.SetRow? {
        var best: (row: VocabSectionDetail.SetRow, left: Int)?
        for row in detail.sets {
            let total = row.progress.total > 0 ? row.progress.total : row.wordCount
            let left = max(0, total - row.progress.mastered)
            if left > 0, left > (best?.left ?? 0) { best = (row, left) }
        }
        return best?.row
    }
}
