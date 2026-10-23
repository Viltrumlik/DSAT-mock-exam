import Testing
@testable import MasterSATKit

@Suite struct LinkPlacementTests {

    @Test("The tabs are Today · Class · Words · Rewards · Explore, in that order")
    func tabOrder() {
        // The floating tab bar draws `allCases` left to right, so this order IS the bar's.
        #expect(AppTab.allCases == [.today, .classes, .words, .rewards, .explore])
    }

    @Test("A link that IS a tab switches to it")
    func tabs() {
        #expect(AppLink.home.placement == .tab(.today))
        #expect(AppLink.classes.placement == .tab(.classes))
        #expect(AppLink.vocabulary.placement == .tab(.words))
    }

    @Test("Class work is pushed onto the Class tab")
    func classWork() {
        let links: [AppLink] = [
            .classroom(id: 3), .homework(classroomId: 3, assignmentId: 9), .assessments,
            .midterms, .midtermResult(attemptId: 4), .examReview(attemptId: 4), .liveQuiz(sessionId: nil),
        ]
        for link in links { #expect(link.placement == .push(.classes, link)) }
    }

    @Test("A word set or section is pushed onto Words")
    func words() {
        #expect(AppLink.vocabularySet(id: 7).placement == .push(.words, .vocabularySet(id: 7)))
        #expect(AppLink.vocabularySection(id: 2).placement == .push(.words, .vocabularySection(id: 2)))
    }

    @Test("Points, shop and leaderboard are pushed onto Rewards")
    func rewards() {
        for link in [AppLink.points, .shop, .leaderboard] {
            #expect(link.placement == .push(.rewards, link))
        }
    }

    @Test("Roadmap, services, events and surveys are pushed onto Explore")
    func explore() {
        let links: [AppLink] = [.roadmap, .roadmapDelivery(id: 5), .services, .support, .events, .surveys, .survey(id: 8)]
        for link in links { #expect(link.placement == .push(.explore, link)) }
    }

    @Test("Profile opens the Me sheet; progress is pushed inside it")
    func me() {
        #expect(AppLink.profile.placement == .me(push: nil))
        #expect(AppLink.progress.placement == .me(push: .progress))
    }

    @Test("A certificate gets its own sheet; an unknown page opens on the site")
    func sheetsAndWeb() {
        #expect(AppLink.certificate(code: "AB12").placement == .certificate(code: "AB12"))
        #expect(AppLink.unknown("/teacher").placement == .web)
    }
}
