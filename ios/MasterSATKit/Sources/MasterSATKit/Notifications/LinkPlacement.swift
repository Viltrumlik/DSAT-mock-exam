import Foundation

/// The app's five tabs. Named in the kit so where a link lands can be tested without a UI.
public enum AppTab: String, CaseIterable, Sendable, Hashable {
    case today, classes, words, rewards, explore
}

/// Where opening an `AppLink` takes the student.
///
/// A page always lands INSIDE the tab it belongs to, pushed onto that tab's stack, so Back
/// walks the student out the way they would have walked in. Only the certificate keeps a
/// sheet of its own (it brings its own stack, Done and Share), and only Me lives in a sheet.
public enum LinkPlacement: Equatable, Sendable {
    /// Switch to the tab and pop it to its root.
    case tab(AppTab)
    /// Switch to the tab, pop it to its root, then push the page.
    case push(AppTab, AppLink)
    /// Open the Me sheet, optionally pushing a page inside it.
    case me(push: AppLink?)
    /// The certificate viewer, in its own sheet.
    case certificate(code: String)
    /// A page the app does not have; open it on the site.
    case web
}

extension AppLink {
    public var placement: LinkPlacement {
        switch self {
        case .home: return .tab(.today)
        // The roadmap is the Class tab now: its level cards are the ladder, and a session's
        // reading is pushed there, where its class page lives.
        case .classes, .roadmap: return .tab(.classes)
        case .classroom, .homework, .assessments, .midterms, .midtermResult, .examReview, .liveQuiz, .roadmapDelivery:
            return .push(.classes, self)
        case .vocabulary: return .tab(.words)
        case .vocabularySection, .vocabularySet: return .push(.words, self)
        case .points, .shop, .leaderboard: return .push(.rewards, self)
        case .services, .support, .events, .surveys, .survey:
            return .push(.explore, self)
        case .profile: return .me(push: nil)
        case .progress: return .me(push: self)
        case .certificate(let code): return .certificate(code: code)
        case .unknown: return .web
        }
    }
}
