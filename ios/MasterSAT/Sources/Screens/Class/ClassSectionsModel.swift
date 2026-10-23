import SwiftUI
import MasterSATKit

/// The People and Files segments' data, per class, kept while the tab lives — switching
/// segments or chips never reloads what is already on screen, and a failure keeps the last
/// answer (`ClassroomLoad`).
@MainActor
@Observable
final class ClassSectionsModel {
    /// One kind of per-class data.
    enum Part: Sendable { case board, members, files }

    private(set) var boards: [Int: ClassroomLoad<RankingBoard>] = [:]
    private(set) var people: [Int: ClassroomLoad<[ClassroomMember]>] = [:]
    private(set) var materials: [Int: ClassroomLoad<[ClassroomMaterial]>] = [:]
    /// The pull-to-refresh each segment last loaded for; a newer one reloads it. Written only once
    /// a run has gone through (`loadPeople`), so a run that was cancelled half way, or that failed,
    /// leaves the next one to do it again.
    @ObservationIgnored private var peopleRefresh = 0
    @ObservationIgnored private var filesRefresh = 0

    func board(_ id: Int) -> ClassroomLoad<RankingBoard> { boards[id] ?? ClassroomLoad() }
    func members(_ id: Int) -> ClassroomLoad<[ClassroomMember]> { people[id] ?? ClassroomLoad() }
    func files(_ id: Int) -> ClassroomLoad<[ClassroomMaterial]> { materials[id] ?? ClassroomLoad() }

    func loadPeople(for ids: [Int], api: ClassroomAPI, refreshID: Int) async {
        let force = refreshID != peopleRefresh
        var succeeded = true
        for id in ids {
            // The chip or the pull-to-refresh moved on: the task that replaced this one loads
            // what is on screen now.
            if Task.isCancelled { return }
            let board = await load(.board, id, api: api, force: force)
            let members = await load(.members, id, api: api, force: force)
            succeeded = succeeded && board && members
        }
        if succeeded, !Task.isCancelled { peopleRefresh = refreshID }
    }

    func loadFiles(for ids: [Int], api: ClassroomAPI, refreshID: Int) async {
        let force = refreshID != filesRefresh
        var succeeded = true
        for id in ids {
            if Task.isCancelled { return }
            let files = await load(.files, id, api: api, force: force)
            succeeded = succeeded && files
        }
        if succeeded, !Task.isCancelled { filesRefresh = refreshID }
    }

    /// One part of one class. Skipped when it has loaded and `force` is off, or when it is
    /// already on its way. True unless the request itself failed.
    @discardableResult
    func load(_ part: Part, _ id: Int, api: ClassroomAPI, force: Bool) async -> Bool {
        switch part {
        case .board: await load(\.boards, id, force: force) { try await api.rankings(classroomId: id) }
        case .members: await load(\.people, id, force: force) { try await api.people(classroomId: id) }
        case .files: await load(\.materials, id, force: force) { try await api.materials(classroomId: id) }
        }
    }

    private func load<Value: Sendable>(
        _ slot: ReferenceWritableKeyPath<ClassSectionsModel, [Int: ClassroomLoad<Value>]>,
        _ id: Int,
        force: Bool,
        _ fetch: @escaping @MainActor () async throws -> Value
    ) async -> Bool {
        let current = self[keyPath: slot][id] ?? ClassroomLoad()
        guard force || !current.hasLoaded, !current.isLoading else { return true }
        var start = current
        start.isLoading = true
        self[keyPath: slot][id] = start
        let done = await Self.fetched(start, fetch)
        self[keyPath: slot][id] = done
        return done.error == nil
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
