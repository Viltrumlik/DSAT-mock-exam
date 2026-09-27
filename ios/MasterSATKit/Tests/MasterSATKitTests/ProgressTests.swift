import Foundation
import Testing
@testable import MasterSATKit

private func decodeJSON<T: Decodable>(_ type: T.Type, _ object: Any) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: JSONSerialization.data(withJSONObject: object))
}

// The web suite's fixtures (`peerInsights.test.ts`), rebuilt: a metric defaults to you 80 /
// group 70 / upper half, and a group to an English Middle class of twelve.
private func metric(
    you: Double? = 80,
    average: Double? = 70,
    median: Double? = 72,
    measured: Int? = 12,
    standing: PeerProgressStanding? = .upperHalf
) -> PeerProgressMetric {
    PeerProgressMetric(you: you, groupAverage: average, groupMedian: median, measured: measured, standing: standing)
}

private func group(
    standingsHidden: Bool = false,
    trend: [PeerTrendMonth] = [],
    attendance: PeerProgressMetric = metric(),
    attendanceDetail: PeerAttendanceDetail = PeerAttendanceDetail(present: 9, late: 1, absent: 1),
    homework: PeerProgressMetric = metric(),
    homeworkDetail: PeerHomeworkDetail = PeerHomeworkDetail(completed: 6, total: 8, remaining: 2),
    overall: PeerProgressMetric = metric(),
    vocabulary: PeerProgressMetric? = nil
) -> PeerProgressGroup {
    PeerProgressGroup(
        subject: "english", subjectLabel: "English", classroomId: 34, classroomName: "Middle G4",
        level: "middle", levelLabel: "Middle", groupSize: 12, standingsHidden: standingsHidden,
        metrics: PeerProgressMetrics(
            attendance: attendance, attendanceDetail: attendanceDetail,
            homework: homework, homeworkDetail: homeworkDetail,
            overall: overall, vocabulary: vocabulary
        ),
        attendanceTrend: trend
    )
}

/// One metric as the server writes it.
private func peerMetric(_ you: Any, _ avg: Any, _ standing: Any) -> [String: Any] {
    ["you": you, "group_average": avg, "group_median": avg, "measured": 17, "standing": standing]
}

/// Words a student-facing sentence must never use about them.
private let punishing = ["behind", "low", "last", "worst", "bad", "poor", "fail"]

@Suite struct ProgressDecodingTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> ProgressAPI {
        ProgressAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    @Test("The ladder decodes, and an unknown number stays unknown")
    func ladderDecodes() async throws {
        server.handler = { _ in
            .json([
                "tracks": [[
                    "subject": "english", "subject_label": "English",
                    "current_level": "middle", "current_level_label": "Middle",
                    "levels": [
                        [
                            "level": "junior", "level_label": "Junior", "state": "not-recorded",
                            "classroom_id": NSNull(), "classroom_name": NSNull(),
                            "attendance": NSNull(), "homework": NSNull(), "overall": NSNull(), "basis": [],
                        ],
                        [
                            "level": "middle", "level_label": "Middle", "state": "current",
                            "classroom_id": 34, "classroom_name": "Middle G4",
                            "attendance": ["rate": 92.5, "present": 12, "late": 1, "absent": 0, "excused": 1, "counted": 13],
                            "homework": ["rate": 75.0, "completed": 6, "total": 8],
                            "overall": 83.8, "basis": ["attendance", "homework"],
                        ],
                        [
                            "level": "senior", "level_label": "Senior", "state": "upcoming",
                            "classroom_id": NSNull(), "classroom_name": NSNull(),
                            // An all-excused register: the object exists, the rate does not.
                            "attendance": ["rate": NSNull(), "present": 0, "late": 0, "absent": 0, "excused": 2, "counted": 0],
                            "homework": NSNull(), "overall": NSNull(), "basis": [],
                        ],
                    ],
                ]],
                "overall": 83.8,
                "weights": ["attendance": 0.5, "homework": 0.5],
            ])
        }
        let report = try await api().progress()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/progress/")
        #expect(report.overall == 83.8)
        #expect(report.weights.attendance == 0.5)

        let track = try #require(report.tracks.first)
        #expect(track.currentLevelLabel == "Middle")
        #expect(track.levels.map(\.state) == [.notRecorded, .current, .upcoming])

        let middle = track.levels[1]
        #expect(middle.classroomName == "Middle G4")
        #expect(middle.attendance?.rate == 92.5)
        #expect(middle.attendance?.counted == 13)
        #expect(middle.homework?.total == 8)
        #expect(middle.basis == ["attendance", "homework"])

        #expect(track.levels[0].overall == nil)
        #expect(track.levels[0].attendance == nil)
        #expect(track.levels[2].attendance != nil)
        #expect(track.levels[2].attendance?.rate == nil)
    }

    @Test("A bare body still decodes: no tracks, no overall, the stated weights")
    func bareProgress() throws {
        let report = try decodeJSON(MyProgressReport.self, [String: Any]())
        #expect(report.tracks.isEmpty)
        #expect(report.overall == nil)
        #expect(report.weights == MyProgressReport.Weights(attendance: 0.5, homework: 0.5))

        let odd = try decodeJSON(MyProgressReport.self, [
            "tracks": [["subject": "math", "levels": [["level": "junior", "state": "paused", "overall": "61.5"]]]],
        ])
        let level = try #require(odd.tracks.first?.levels.first)
        #expect(level.state == nil)
        #expect(level.overall == 61.5)
        #expect(level.levelLabel == "Junior")
    }

    @Test("The comparison decodes — details beside the metric, vocabulary only for English")
    func peersDecode() async throws {
        server.handler = { _ in
            var attendance = peerMetric(92.5, 81.3, "top_quarter")
            attendance["detail"] = ["present": 12, "late": 1, "absent": 0, "excused": 1]
            var homework = peerMetric(75.0, "80.0", "lower_half")
            homework["detail"] = ["completed": 6, "total": 8, "remaining": 2, "to_reach_average": 1]
            var mathAttendance = peerMetric(NSNull(), NSNull(), NSNull())
            mathAttendance["detail"] = ["present": 0, "late": 0, "absent": 0, "excused": 0]
            return .json([
                "groups": [
                    [
                        "subject": "english", "subject_label": "English", "classroom_id": 34,
                        "classroom_name": "Middle G4", "level": "middle", "level_label": "Middle",
                        "group_size": 18, "standings_hidden": false,
                        "metrics": [
                            "attendance": attendance,
                            "homework": homework,
                            "overall": peerMetric(83.8, 80.1, "upper_half"),
                            "vocabulary": peerMetric(120.0, 85.4, "top_quarter"),
                        ],
                        "recent_lessons": [
                            ["date": "2026-09-07", "status": "PRESENT"],
                            ["date": "2026-09-09", "status": "LATE"],
                            ["date": "2026-09-10", "status": "SICK"],
                            ["date": "2026-09-11", "status": "ABSENT"],
                        ],
                        "attendance_trend": [
                            ["month": "2026-08", "you": 88, "group": 79.5],
                            ["month": "2026-09", "you": 95, "group": NSNull()],
                        ],
                    ],
                    [
                        "subject": "math", "subject_label": "Math", "classroom_id": 12,
                        "classroom_name": "Junior M1", "level": "junior", "level_label": "Junior",
                        "group_size": 3, "standings_hidden": true,
                        "metrics": [
                            "attendance": mathAttendance,
                            "homework": peerMetric(NSNull(), NSNull(), NSNull()),
                            "overall": peerMetric(NSNull(), NSNull(), NSNull()),
                        ],
                        "recent_lessons": [], "attendance_trend": [],
                    ],
                    ["classroom_name": "No id — dropped"],
                ],
                "min_peers": 4,
            ])
        }
        let peers = try await api().peers()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/classes/progress/peers/")
        #expect(peers.minPeers == 4)
        #expect(peers.groups.map(\.classroomId) == [34, 12])

        let english = peers.groups[0]
        #expect(english.groupSize == 18)
        #expect(english.metrics.attendance.standing == .topQuarter)
        #expect(english.metrics.attendanceDetail == PeerAttendanceDetail(present: 12, late: 1, absent: 0, excused: 1))
        // A group average that arrived as a decimal string is still a number.
        #expect(english.metrics.homework.groupAverage == 80)
        #expect(english.metrics.homeworkDetail.toReachAverage == 1)
        #expect(english.metrics.vocabulary?.you == 120)
        // An unknown mark is dropped rather than drawn as something it isn't.
        #expect(english.recentLessons.map(\.status) == [.present, .late, .absent])
        #expect(english.attendanceTrend.last?.group == nil)

        let math = peers.groups[1]
        #expect(math.metrics.vocabulary == nil)
        #expect(math.standingsHidden)
        #expect(math.metrics.attendance.you == nil)
        #expect(math.metrics.homeworkDetail == PeerHomeworkDetail())
    }

    @Test("min_peers defaults to the server's four")
    func minPeersDefault() throws {
        let peers = try decodeJSON(PeerProgress.self, ["groups": []])
        #expect(peers.groups.isEmpty)
        #expect(peers.minPeers == 4)
    }
}

@Suite struct PeerInsightsTests {

    @Test("Names the top quarter, together, when a student is there on more than one measure")
    func topQuarterTogether() {
        let g = group(
            attendance: metric(standing: .topQuarter),
            attendanceDetail: PeerAttendanceDetail(present: 10),
            vocabulary: metric(standing: .topQuarter)
        )
        let texts = PeerInsights.insights(for: g, minPeers: 4).map(\.text)
        #expect(texts.first == "Top quarter of your group for attendance and words mastered.")
    }

    @Test("Three measures in the top quarter read as a list")
    func topQuarterList() {
        let g = group(
            attendance: metric(standing: .topQuarter),
            homework: metric(standing: .topQuarter),
            vocabulary: metric(standing: .topQuarter)
        )
        #expect(PeerInsights.insights(for: g, minPeers: 4).first?.text
            == "Top quarter of your group for attendance, homework and words mastered.")
    }

    @Test("Upper half overall is said when there is no top quarter")
    func upperHalf() {
        let insights = PeerInsights.insights(for: group(), minPeers: 4)
        #expect(insights.first?.key == "upper")
        #expect(insights.first?.text == "Overall, you're in the upper half of your group.")
    }

    @Test("Turns a homework gap into the number of pieces that close it")
    func homeworkGap() {
        let g = group(
            homework: metric(you: 50, standing: .lowerHalf),
            homeworkDetail: PeerHomeworkDetail(completed: 4, total: 8, remaining: 4, toReachAverage: 2)
        )
        let gap = PeerInsights.insights(for: g, minPeers: 4).first { $0.key == "homework-gap" }
        #expect(gap?.text == "2 more homework bring you up to your group's average.")
        #expect(gap?.tone == .warning)

        let one = group(homeworkDetail: PeerHomeworkDetail(completed: 5, total: 8, remaining: 3, toReachAverage: 1))
        #expect(PeerInsights.insights(for: one, minPeers: 4).contains {
            $0.text == "1 more homework brings you up to your group's average."
        })
    }

    @Test("Says attendance under the group's as what moves it, never as a verdict")
    func attendanceGap() {
        let g = group(
            attendance: metric(you: 60, average: 84.4, standing: .lowerHalf),
            attendanceDetail: PeerAttendanceDetail(present: 6, absent: 4),
            overall: metric(standing: .lowerHalf)
        )
        let insights = PeerInsights.insights(for: g, minPeers: 4)
        #expect(insights.map(\.key).contains("attendance-gap"))
        #expect(insights.first { $0.key == "attendance-gap" }?.text
            == "Your group attends 84% of lessons — every lesson you come to closes the gap.")
        for insight in insights {
            let words = insight.text.lowercased()
            for word in punishing {
                #expect(!words.contains(word))
            }
        }
    }

    @Test("Says why there is no group figure instead of guessing one")
    func noGroupFigure() {
        let none = metric(average: nil, median: nil, measured: nil, standing: nil)
        let g = group(
            attendance: none, attendanceDetail: PeerAttendanceDetail(present: 3),
            homework: none, homeworkDetail: PeerHomeworkDetail(completed: 1, total: 2, remaining: 1),
            overall: none
        )
        #expect(PeerInsights.insights(for: g, minPeers: 4) == [PeerInsight(
            key: "few", tone: .muted, icon: .users,
            text: "Group figures appear once 4 classmates have marks in this class."
        )])
    }

    @Test("Leads with this month when a student under the group's term average is ahead of it now")
    func aheadThisMonth() {
        // The shape of a real group on production: under the group across the term, ahead in September.
        let g = group(
            trend: [
                PeerTrendMonth(month: "2026-08", you: 62.5, group: 80.2),
                PeerTrendMonth(month: "2026-09", you: 70, group: 69.2),
            ],
            attendance: metric(you: 66.7, average: 74.1, standing: .lowerHalf),
            attendanceDetail: PeerAttendanceDetail(present: 8, absent: 4),
            overall: metric(standing: .lowerHalf)
        )
        let insights = PeerInsights.insights(for: g, minPeers: 4)
        #expect(insights.first?.text == "In September your attendance (70%) is above your group's (69%).")
        // …and the term-average line that would contradict it is not said in the same breath.
        #expect(!insights.map(\.key).contains("attendance-gap"))
    }

    @Test("Notices attendance rising month on month")
    func trendUp() {
        let g = group(
            trend: [
                PeerTrendMonth(month: "2026-07", you: 60, group: 75),
                PeerTrendMonth(month: "2026-08", you: 71.4, group: 78),
            ],
            overall: metric(standing: .lowerHalf)
        )
        #expect(PeerInsights.insights(for: g, minPeers: 4).map(\.text).contains(
            "Your attendance is up from 60% in July to 71% in August."
        ))
    }

    @Test("A rise under five points, or months the student was not marked in, say nothing")
    func trendQuiet() {
        let small = group(
            trend: [PeerTrendMonth(month: "2026-07", you: 60, group: 75), PeerTrendMonth(month: "2026-08", you: 64.9, group: 78)],
            overall: metric(standing: .lowerHalf)
        )
        #expect(!PeerInsights.insights(for: small, minPeers: 4).map(\.key).contains("trend-up"))

        // Unmarked months are skipped, so the comparison is between the two MARKED ones.
        let gaps = group(
            trend: [
                PeerTrendMonth(month: "2026-06", you: 50, group: 75),
                PeerTrendMonth(month: "2026-07", you: nil, group: 75),
                PeerTrendMonth(month: "2026-08", you: 60, group: 78),
            ],
            overall: metric(standing: .lowerHalf)
        )
        #expect(PeerInsights.insights(for: gaps, minPeers: 4).map(\.text).contains(
            "Your attendance is up from 50% in June to 60% in August."
        ))
    }

    @Test("A top-quarter attender ahead this month hears the trend instead, not the same news twice")
    func topQuarterSkipsMonthLine() {
        let g = group(
            trend: [PeerTrendMonth(month: "2026-08", you: 80, group: 70), PeerTrendMonth(month: "2026-09", you: 90, group: 70)],
            attendance: metric(you: 90, average: 70, standing: .topQuarter)
        )
        let keys = PeerInsights.insights(for: g, minPeers: 4).map(\.key)
        #expect(!keys.contains("month-ahead"))
        #expect(keys.contains("trend-up"))
    }

    @Test("Explains hidden standings")
    func hiddenStandings() {
        let g = group(standingsHidden: true, overall: metric(standing: nil))
        #expect(PeerInsights.insights(for: g, minPeers: 4).map(\.key).contains("hidden"))
    }

    @Test("Stops at three")
    func stopsAtThree() {
        let g = group(
            standingsHidden: true,
            attendance: metric(you: 50, average: 80, standing: .topQuarter),
            attendanceDetail: PeerAttendanceDetail(present: 5, absent: 5),
            homework: metric(standing: .lowerHalf),
            homeworkDetail: PeerHomeworkDetail(completed: 1, total: 8, remaining: 7, toReachAverage: 4)
        )
        #expect(PeerInsights.insights(for: g, minPeers: 4).count == 3)
    }

    @Test("gapToGroup is the student minus the group, to a tenth, or nil when either is missing")
    func gap() {
        #expect(PeerInsights.gapToGroup(metric(you: 92.5, average: 81.3)) == 11.2)
        #expect(PeerInsights.gapToGroup(metric(you: nil)) == nil)
        #expect(PeerInsights.gapToGroup(metric(average: nil)) == nil)
        #expect(PeerInsights.gapToGroup(nil) == nil)
        // JavaScript rounds halves up, towards +∞ — so a gap of −2.25 is −2.2, as on the web.
        #expect(PeerInsights.gapToGroup(metric(you: 70, average: 72.25)) == -2.2)
    }

    @Test("Month names are English whatever the phone's region")
    func monthNames() {
        #expect(PeerInsights.monthName("2026-09") == "September")
        #expect(PeerInsights.monthName("2026-01") == "January")
        #expect(PeerInsights.monthName("2026-12") == "December")
        #expect(PeerInsights.monthName("2026") == "January")
        #expect(PeerInsights.monthName("2026-13") == "January")
    }
}

@Suite struct ProgressWordingTests {

    @Test("Unknown numbers show a dash, never 0%")
    func dashNotZero() {
        #expect(ProgressFormat.percent(nil) == "—")
        #expect(ProgressFormat.percent(Double.nan) == "—")
        #expect(ProgressFormat.percent(0) == "0%")
        #expect(ProgressFormat.percent(83.8) == "84%")
        #expect(ProgressFormat.percent(92.5) == "93%")
        #expect(ProgressFormat.count(nil) == "—")
        #expect(ProgressFormat.count(120) == "120")
    }

    @Test("Rounding is JavaScript's: halves go up")
    func jsRound() {
        #expect(ProgressFormat.jsRound(2.5) == 3)
        #expect(ProgressFormat.jsRound(-2.5) == -2)
        #expect(ProgressFormat.jsRound(-2.6) == -3)
        #expect(ProgressFormat.jsRound(-0.4) == 0)
    }

    @Test("The delta chip: plus, a true minus, or level")
    func deltaChip() {
        #expect(ProgressFormat.deltaChip(11.2) == "+11 vs group")
        #expect(ProgressFormat.deltaChip(-4.2) == "−4 vs group")
        #expect(ProgressFormat.deltaChip(0.4) == "Level with group")
        #expect(ProgressFormat.deltaChip(-0.5) == "Level with group")
        #expect(ProgressFormat.deltaChip(nil) == nil)
    }

    @Test("A tile's words, from the web's own test case")
    func tileWords() {
        let attendance = metric(you: 92.5, average: 81.3, median: 85, measured: 17, standing: .topQuarter)
        #expect(PeerMetricText.value(attendance, unit: .percent) == "93%")
        #expect(PeerMetricText.groupAverage(attendance, unit: .percent) == "Group average 81%")
        #expect(ProgressFormat.deltaChip(PeerInsights.gapToGroup(attendance)) == "+11 vs group")
        #expect(PeerMetricText.band(attendance, unit: .percent) == "Top quarter of your group")

        // The lower-half band is said as a distance to the average, not as a label.
        let homework = metric(you: 75, average: 80, standing: .lowerHalf)
        #expect(PeerMetricText.band(homework, unit: .percent) == "5 points to your group's average")
        #expect(PeerMetricText.band(metric(standing: .upperHalf), unit: .percent) == "Upper half of your group")
        #expect(PeerMetricText.band(metric(standing: nil), unit: .percent) == nil)

        let words = metric(you: 60, average: 85.4, standing: .lowerHalf)
        #expect(PeerMetricText.value(words, unit: .words) == "60")
        #expect(PeerMetricText.groupAverage(words, unit: .words) == "Group average 85 words")
        #expect(PeerMetricText.band(words, unit: .words) == "25 words to your group's average")

        // A withheld group figure reads as missing — never "Group average 0%".
        let none = metric(average: nil, median: nil, measured: nil, standing: nil)
        #expect(PeerMetricText.groupAverage(none, unit: .percent) == "No group figure yet")
    }

    @Test("Tile details say what was marked and what is left")
    func tileDetails() {
        #expect(PeerMetricText.attendanceDetail(metric(), detail: PeerAttendanceDetail(present: 12, late: 1, absent: 0, excused: 1))
            == "12 present · 1 late · 1 excused")
        #expect(PeerMetricText.attendanceDetail(metric(), detail: PeerAttendanceDetail(present: 0, absent: 2))
            == "0 present · 2 missed")
        #expect(PeerMetricText.attendanceDetail(metric(you: nil), detail: PeerAttendanceDetail())
            == "Nothing marked for you yet")
        #expect(PeerMetricText.homeworkDetail(PeerHomeworkDetail(completed: 6, total: 8, remaining: 2))
            == "6 of 8 done · 2 left")
        #expect(PeerMetricText.homeworkDetail(PeerHomeworkDetail()) == "No homework set yet")
        #expect(PeerMetricText.groupSize(18) == "18 students")
        #expect(PeerMetricText.groupSize(1) == "1 student")
    }

    @Test("A tile's scale: percentages out of 100, counts out of a quarter more than the larger")
    func scale() {
        func near(_ value: Double?, _ expected: Double) -> Bool {
            guard let value else { return false }
            return abs(value - expected) < 1e-9
        }
        let percent = PeerMetricText.scale(metric(you: 92.5, average: 81.3), unit: .percent)
        #expect(near(percent.you, 0.925))
        #expect(near(percent.group, 0.813))
        let words = PeerMetricText.scale(metric(you: 120, average: 60), unit: .words)
        #expect(near(words.you, 0.8))
        #expect(near(words.group, 0.4))
        let capped = PeerMetricText.scale(metric(you: 130, average: -5), unit: .percent)
        #expect(capped.you == 1)
        #expect(capped.group == 0)
        let unknown = PeerMetricText.scale(metric(you: nil, average: nil), unit: .percent)
        #expect(unknown.you == nil && unknown.group == nil)
    }

    @Test("The ladder's words")
    func ladderWords() throws {
        #expect(MyProgressText.pill(.current) == "Studying now")
        #expect(MyProgressText.pill(.done) == "Finished")
        #expect(MyProgressText.pill(.notRecorded) == "No record")
        #expect(MyProgressText.pill(.upcoming) == "Ahead of you")
        #expect(MyProgressText.pill(nil) == "No record")

        #expect(MyProgressText.emptyNote(.upcoming) == "You haven’t started this level yet.")
        #expect(MyProgressText.emptyNote(.notRecorded) == "You joined the course after this level, so there is nothing recorded here.")
        #expect(MyProgressText.emptyNote(.current) == "Nothing has been marked or set for this level yet.")

        #expect(MyProgressText.attendanceDetail(nil) == "not marked")
        #expect(MyProgressText.homeworkDetail(nil) == "none set")
        #expect(MyProgressText.basisNote(["attendance"])
            == "Counted from attendance only — there is nothing recorded for the other half yet.")
        #expect(MyProgressText.basisNote(["attendance", "homework"]) == nil)
        #expect(MyProgressText.basisNote([]) == nil)

        let level = try decodeJSON(MyProgressLevel.self, [
            "level": "middle",
            "attendance": ["rate": 83.3, "present": 12, "late": 1, "absent": 2, "excused": 1, "counted": 15],
            "homework": ["rate": 75, "completed": 6, "total": 8],
        ])
        // Excused is not in the ladder's line — it is out of the denominator altogether.
        #expect(MyProgressText.attendanceDetail(level.attendance) == "12 present · 1 late · 2 missed")
        #expect(MyProgressText.homeworkDetail(level.homework) == "6 of 8")

        let track = try decodeJSON(MyProgressTrack.self, ["subject": "math", "current_level_label": "Junior"])
        #expect(MyProgressText.trackLine(track) == "You are on Junior.")
        let unset = try decodeJSON(MyProgressTrack.self, ["subject": "math"])
        #expect(MyProgressText.trackLine(unset) == "No level set on your class yet.")
    }

    @Test("Plain server dates are read as the local calendar day")
    func localDays() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let day = try #require(LearnDates.day("2026-09-07", calendar: calendar))
        #expect(calendar.component(.day, from: day) == 7)
        let month = try #require(LearnDates.month("2026-09", calendar: calendar))
        #expect(calendar.component(.month, from: month) == 9)
        #expect(LearnDates.day("soon") == nil)
    }
}
