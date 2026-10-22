import SwiftUI
import MasterSATKit

/// The People and Files segments' data, per class, kept while the tab lives — switching
/// segments or chips never reloads what is already on screen, and a failure keeps the last
/// answer (`ClassroomLoad`).
@MainActor
@Observable
final class ClassSectionsModel {
    private(set) var boards: [Int: ClassroomLoad<RankingBoard>] = [:]
    private(set) var people: [Int: ClassroomLoad<[ClassroomMember]>] = [:]
    private(set) var materials: [Int: ClassroomLoad<[ClassroomMaterial]>] = [:]
    /// The pull-to-refresh each segment last loaded for; a newer one reloads it.
    @ObservationIgnored private var peopleRefresh = 0
    @ObservationIgnored private var filesRefresh = 0

    func board(_ id: Int) -> ClassroomLoad<RankingBoard> { boards[id] ?? ClassroomLoad() }
    func members(_ id: Int) -> ClassroomLoad<[ClassroomMember]> { people[id] ?? ClassroomLoad() }
    func files(_ id: Int) -> ClassroomLoad<[ClassroomMaterial]> { materials[id] ?? ClassroomLoad() }

    func loadPeople(for ids: [Int], api: ClassroomAPI, refreshID: Int) async {
        let force = refreshID != peopleRefresh
        peopleRefresh = refreshID
        for id in ids {
            // The chip or the pull-to-refresh moved on: the task that replaced this one loads
            // what is on screen now.
            if Task.isCancelled { return }
            await loadBoard(id, api: api, force: force)
            await loadMembers(id, api: api, force: force)
        }
    }

    func loadFiles(for ids: [Int], api: ClassroomAPI, refreshID: Int) async {
        let force = refreshID != filesRefresh
        filesRefresh = refreshID
        for id in ids {
            if Task.isCancelled { return }
            await loadMaterials(id, api: api, force: force)
        }
    }

    func loadBoard(_ id: Int, api: ClassroomAPI, force: Bool) async {
        let current = board(id)
        guard force || !current.hasLoaded, !current.isLoading else { return }
        var start = current
        start.isLoading = true
        boards[id] = start
        boards[id] = await Self.fetched(start) { try await api.rankings(classroomId: id) }
    }

    func loadMembers(_ id: Int, api: ClassroomAPI, force: Bool) async {
        let current = members(id)
        guard force || !current.hasLoaded, !current.isLoading else { return }
        var start = current
        start.isLoading = true
        people[id] = start
        people[id] = await Self.fetched(start) { try await api.people(classroomId: id) }
    }

    func loadMaterials(_ id: Int, api: ClassroomAPI, force: Bool) async {
        let current = files(id)
        guard force || !current.hasLoaded, !current.isLoading else { return }
        var start = current
        start.isLoading = true
        materials[id] = start
        materials[id] = await Self.fetched(start) { try await api.materials(classroomId: id) }
    }

    /// One request, finished whatever happens to the view task that asked. A chip change or a
    /// pull-to-refresh cancels that task while the request is out, and the task that replaces it
    /// skips anything still `isLoading` — so a request cancelled with it would be recorded as a
    /// failure nobody retries. Run on its own, it always lands.
    private static func fetched<Value: Sendable>(
        _ start: ClassroomLoad<Value>,
        _ fetch: @escaping @MainActor () async throws -> Value
    ) async -> ClassroomLoad<Value> {
        let request = Task { try await fetch() }
        var load = start
        do {
            load.value = try await request.value
            load.error = nil
        } catch {
            load.error = ClassroomLoad<Value>.message(for: error)
        }
        load.isLoading = false
        load.hasLoaded = true
        return load
    }
}
