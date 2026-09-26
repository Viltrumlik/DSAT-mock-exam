import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ClassroomFeatureTests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func client() -> APIClient {
        APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        )
    }

    private func classroom(_ json: [String: Any]) throws -> Classroom {
        try JSONCoding.decoder.decode(Classroom.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func member(role: String, account: String?) throws -> ClassroomMember {
        var user: [String: Any] = ["id": 1, "first_name": "A", "email": "a@x.uz"]
        if let account { user["role"] = account }
        return try JSONCoding.decoder.decode(
            ClassroomMember.self,
            from: JSONSerialization.data(withJSONObject: ["id": 1, "role": role, "user": user])
        )
    }

    // MARK: - Header and card

    @Test("\"N students\" counts students, not the whole membership")
    func headCountPrefersStudents() throws {
        // members_count also counts the teaching team; the class card read "14 students" for
        // a class of twelve.
        let room = try classroom(["id": 1, "name": "A", "members_count": 14, "student_count": 12])
        #expect(room.headCount == 12)
        let older = try classroom(["id": 1, "name": "A", "members_count": 14])
        #expect(older.headCount == 14)
    }

    @Test("The class card reads days · 12-hour time · room, as the site writes it")
    func cardScheduleLine() throws {
        let room = try classroom([
            "id": 1, "name": "A", "subject": "MATH", "lesson_days": "EVEN",
            "lesson_time": "17:00", "room_number": "204",
        ])
        #expect(room.cardScheduleLine == "Tue, Thu, Sat · 5:00 PM · Room 204")
        #expect(room.headerScheduleLine == "Tue, Thu, Sat · 17:00")
        #expect(room.subjectLabel == "Math")

        let bare = try classroom(["id": 2, "name": "B", "subject": "READING_WRITING"])
        #expect(bare.cardScheduleLine == "English")
        #expect(bare.headerScheduleLine == "")
    }

    @Test("Times and rooms are formatted the web's way, and free text is left alone")
    func scheduleFormatting() {
        #expect(ClassroomSchedule.time12h("09:30") == "9:30 AM")
        #expect(ClassroomSchedule.time12h("12:05") == "12:05 PM")
        #expect(ClassroomSchedule.time12h("00:15") == "12:15 AM")
        #expect(ClassroomSchedule.time12h("after school") == "after school")
        #expect(ClassroomSchedule.roomLabel("12") == "Room 12")
        #expect(ClassroomSchedule.roomLabel("Room 5") == "Room 5")
        #expect(ClassroomSchedule.roomLabel("room-5") == "room-5")
        #expect(ClassroomSchedule.roomLabel(" ") == "")
        #expect(ClassroomSchedule.daysShort("ODD") == "Mon, Wed, Fri")
    }

    @Test("The classes filter counts anything that is not maths as English")
    func subjectFilter() throws {
        let math = try classroom(["id": 1, "name": "M", "subject": "MATH"])
        let english = try classroom(["id": 2, "name": "E", "subject": "ENGLISH"])
        let unknown = try classroom(["id": 3, "name": "U"])
        #expect(ClassroomSubjectFilter.math.matches(math))
        #expect(!ClassroomSubjectFilter.math.matches(english))
        #expect(ClassroomSubjectFilter.english.matches(unknown))
        #expect(ClassroomSubjectFilter.all.matches(math))
    }

    // MARK: - People

    @Test("Staff are titled by their account, never by the membership seat")
    func staffTitles() throws {
        // An ownership transfer makes the class's teacher OWNER; they are still a teacher.
        #expect(try member(role: "OWNER", account: "teacher").staffTitle == "Teacher")
        #expect(try member(role: "TEACHER", account: "super_admin").staffTitle == "Owner")
        #expect(try member(role: "TEACHER", account: "admin").staffTitle == "Admin")
        #expect(try member(role: "TA", account: "support_teacher").staffTitle == "Support teacher")
        // A TA seat whose account names no staff job is a support teacher, and "Owner" is
        // never given out by a membership.
        #expect(try member(role: "TA", account: "student").staffTitle == "Support teacher")
        #expect(try member(role: "OWNER", account: nil).staffTitle == "Teacher")
        #expect(try member(role: "STUDENT", account: "student").staffTitle == nil)
    }

    @Test("The teaching team is listed owner first, keeping the server's order within a title")
    func staffOrder() throws {
        let teacherA = try member(role: "OWNER", account: "teacher")
        let owner = try member(role: "TEACHER", account: "super_admin")
        let support = try member(role: "TA", account: "support_teacher")
        let admin = try member(role: "TEACHER", account: "admin")
        let sorted = StaffTitle.sorted([teacherA, support, owner, admin])
        #expect(sorted.map(\.staffTitle) == ["Owner", "Admin", "Teacher", "Support teacher"])
    }

    // MARK: - Materials

    @Test("A material's type, filter and meta line come from its file, as on the site")
    func materialKinds() throws {
        #expect(MaterialKind(fileName: "unit3.PDF").label == "PDF")
        #expect(MaterialKind(fileName: "unit3.PDF").family == .pdf)
        #expect(MaterialKind(fileName: "deck.pptx").category == .slides)
        #expect(MaterialKind(fileName: "listening.m4a").category == .audio)
        #expect(MaterialKind(fileName: "scores.csv").family == .sheet)
        #expect(MaterialKind(fileName: "https://x.uz/media/a/notes.docx?sig=1").label == "DOCX")
        #expect(MaterialKind(fileName: "README").label == "FILE")
        #expect(MaterialKind(fileName: nil).category == .document)

        let material = try JSONCoding.decoder.decode(ClassroomMaterial.self, from: JSONSerialization.data(withJSONObject: [
            "id": 1, "title": "Unit 3", "file_name": "unit3.pdf", "file_size": 2_516_582,
            "created_at": "2026-06-03T09:00:00+05:00",
        ]))
        #expect(material.kind.label == "PDF")
        #expect(material.metaLine(locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "Asia/Tashkent")!) == "2.4 MB · Jun 3")
    }

    // MARK: - Classwork

    @Test("Classwork awards: nothing yet, a looked-at zero, and XP are three different answers")
    func classworkAwardStates() {
        #expect(ClassworkAwardState(nil).badge == "Not marked yet")
        #expect(ClassworkAwardState(nil).isMarked == false)
        let zero = ClassworkAward(points: 0, xp: 0, awardedAt: nil, note: "")
        #expect(ClassworkAwardState(zero) == .reviewed)
        #expect(ClassworkAwardState(zero).badge == "Reviewed")
        #expect(ClassworkAwardState(zero).tileValue == "Reviewed")
        let eight = ClassworkAward(points: 8, xp: 8, awardedAt: nil, note: "")
        #expect(ClassworkAwardState(eight).badge == "+8 XP")
        #expect(ClassworkAwardState(eight).tileValue == "+8")
    }

    @Test("The classwork list asks for CLASSWORK and stamps each row with its class")
    func classworkList() async throws {
        server.handler = { _ in
            .json([
                ["id": 5, "title": "Warm-up", "category": "CLASSWORK", "classwork_award": nil,
                 "assigned_at": "2026-09-20T10:00:00+05:00",
                 "contents": [["kind": "QUIZ", "title": "Linear equations", "item_count": 8, "homework_id": 3]],
                 "vocab_homeworks": [["id": 1, "set_id": 2, "set_title": "Set 1", "word_count": 20, "state": "completed"]]],
                ["id": 6, "title": "Reading", "category": "CLASSWORK",
                 "classwork_award": ["points": 0, "xp": 0, "awarded_at": "2026-09-21T10:00:00Z", "note": ""]],
            ])
        }

        let rows = try await ClassroomAPI(client: client()).classwork(classroomId: 4, classroomName: "Maths A")

        let request = try #require(server.requests.first)
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/classes/4/assignments/?category=CLASSWORK")
        #expect(rows.map(\.classroomId) == [4, 4])
        #expect(rows.first?.classroomName == "Maths A")
        #expect(rows[0].classworkAwardState == .notMarked)
        #expect(rows[1].classworkAwardState == .reviewed)
        #expect(rows[0].activityLabel == "2 activities")
        #expect(rows[1].activityLabel == nil)
        #expect(rows[0].isClasswork)
    }

    // MARK: - Telegram

    private func telegramState(_ extra: [String: Any]) throws -> TelegramGroupState {
        var json: [String: Any] = [
            "managed": true, "group_url": "", "telegram_linked": false, "status": "NONE",
            "removed_reason": "", "eligible": true, "reason": "", "message": "", "invite_link": "",
            "invite_expires_at": NSNull(), "rules": ["One", "Two"], "invite_ttl_minutes": 30,
        ]
        for (key, value) in extra { json[key] = value }
        return try JSONCoding.decoder.decode(TelegramGroupState.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test("The join sheet shows exactly one step, chosen as the site chooses it")
    func telegramSteps() throws {
        #expect(try telegramState(["eligible": false, "message": "While your account is frozen…"]).step
                == .notEligible(message: "While your account is frozen…"))
        #expect(try telegramState(["eligible": false]).step == .nothing)
        #expect(try telegramState([:]).step == .openBot)
        #expect(try telegramState(["telegram_linked": true, "invite_link": "https://t.me/+abc"]).step
                == .inviteReady(link: "https://t.me/+abc"))
        let joined = try telegramState(["telegram_linked": true, "status": "JOINED"])
        #expect(joined.step == .getLink)
        #expect(joined.isJoined)
        #expect(joined.rules == ["One", "Two"])
    }

    @Test("The header offers the sheet for a managed group, else the old link, else nothing")
    func telegramButton() throws {
        let managed = try telegramState(["status": "JOINED"])
        #expect(TelegramGroupButton.resolve(state: managed, classroomGroupURL: "https://t.me/+old") == .join(isJoined: true))
        #expect(TelegramGroupButton.resolve(state: managed, classroomGroupURL: nil).title == "Telegram group")
        let unmanaged = try telegramState(["managed": false])
        #expect(TelegramGroupButton.resolve(state: unmanaged, classroomGroupURL: " https://t.me/+old ") == .link("https://t.me/+old"))
        // A failed lookup falls back to the static link rather than hiding the group.
        #expect(TelegramGroupButton.resolve(state: nil, classroomGroupURL: "https://t.me/+old").title == "Join Telegram group")
        #expect(TelegramGroupButton.resolve(state: unmanaged, classroomGroupURL: "") == .none)
    }

    @Test("The bot link and the invite are POSTs with an empty object, to the class's own routes")
    func telegramRequests() async throws {
        server.handler = { request in
            // `URL.path` drops the trailing slash, so match on the whole string.
            if request.url?.absoluteString.hasSuffix("/bot-link/") == true {
                return .json(["bot_link": "https://t.me/mastersat_bot?start=tok"])
            }
            return .json([
                "managed": true, "telegram_linked": true, "status": "JOINED", "eligible": true,
                "invite_link": "", "already_member": true, "rules": [],
            ])
        }
        let api = ClassroomTelegramAPI(client: client())

        let link = try await api.botLink(classroomId: 7)
        let joined = try await api.join(classroomId: 7)

        #expect(link == "https://t.me/mastersat_bot?start=tok")
        #expect(joined.alreadyMember == true)
        #expect(joined.step == .getLink)
        let requests = server.requests
        #expect(requests.map(\.httpMethod) == ["POST", "POST"])
        #expect(requests[0].url?.absoluteString == "https://mastersat.uz/api/classes/7/telegram/bot-link/")
        #expect(requests[1].url?.absoluteString == "https://mastersat.uz/api/classes/7/telegram/join/")
        #expect(requests[0].httpBody.map { String(decoding: $0, as: UTF8.self) } == "{}")
    }

    @Test("A refusal reaches the caller with the server's own sentence")
    func telegramRefusal() async throws {
        server.handler = { _ in
            .json(["detail": "Open the MasterSAT bot from the button above first — …", "code": "telegram_not_linked"], status: 409)
        }

        await #expect(throws: APIError.self) {
            _ = try await ClassroomTelegramAPI(client: client()).join(classroomId: 7)
        }
        do {
            _ = try await ClassroomTelegramAPI(client: client()).join(classroomId: 7)
        } catch let error as APIError {
            #expect(error.errorDescription?.hasPrefix("Open the MasterSAT bot") == true)
        }
    }
}
