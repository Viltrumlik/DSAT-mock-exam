import SwiftUI
import MasterSATKit

/// The bell's drawer, as a sheet: the inbox under its own navigation bar, with Done.
///
/// `onOpen` receives the destination of a tapped row just before the sheet closes. The bell
/// holds it until the sheet has gone and only then navigates, so a push onto the stack below
/// never races the dismissal.
struct NotificationsInboxSheet: View {
    let onOpen: @MainActor (AppLink) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            NotificationsInboxView(onOpen: onOpen)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

/// The inbox — the web's notification drawer, as a screen.
///
/// Sections as chips with their unread counts, one action to clear what is on screen, then the
/// rows: an unread one carries a dot and heavier type. Tapping a row marks it read and, when it
/// leads somewhere, hands its destination to `onOpen`; a row that leads nowhere only marks
/// itself read, as on the web.
///
/// Four states, all designed: loading, the list, "You're all caught up" — and a failure, which
/// is never drawn as "all caught up". A student told there is nothing new, when the truth is
/// that the list did not load, stops opening the bell.
struct NotificationsInboxView: View {
    let onOpen: @MainActor (AppLink) -> Void

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    private enum Filter: Hashable {
        case all
        case section(String)

        var category: String? {
            if case .section(let code) = self { return code }
            return nil
        }
    }

    @State private var filter: Filter = .all
    /// The last answer per chip, so going back to one is instant and a refresh never blanks it.
    @State private var inboxes: [Filter: NotificationInbox] = [:]
    /// Chips whose latest load failed.
    @State private var failures: Set<Filter> = []
    /// The sections, as the server last served them.
    @State private var sections: [NotificationCategoryOption] = []
    @State private var markingShown = false

    private var api: NotificationsAPI { NotificationsAPI(client: session.client) }
    /// The counts live on the session so the bell, the chips and the app icon agree.
    private var counts: NotificationService { session.notifications }
    private var shown: NotificationInbox? { inboxes[filter] }

    /// Unread in what is on screen: the whole inbox, or the chosen section.
    private var unreadHere: Int {
        guard let category = filter.category else { return counts.unreadTotal }
        return counts.unreadByCategory[category] ?? 0
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !sections.isEmpty {
                    PillTabs(items: chipItems, selection: $filter)
                }
                // Only when there is something to mark: on the web the button also shows on a
                // section with nothing unread, where pressing it does nothing at all.
                if shown != nil, unreadHere > 0 {
                    markShownButton
                }
                content
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: filter) { await load() }
        .refreshable { await load() }
    }

    // MARK: - Pieces

    private var chipItems: [PillTabs<Filter>.Item] {
        var items = [PillTabs<Filter>.Item(tab: .all, title: "All", icon: "tray.full")]
        for section in sections {
            let unread = counts.unreadByCategory[section.value] ?? 0
            items.append(PillTabs<Filter>.Item(
                tab: .section(section.value),
                title: section.label,
                icon: NotificationCategoryLook.icon(for: section.value),
                count: unread > 0 ? unread : nil,
                highlighted: unread > 0
            ))
        }
        return items
    }

    private var markShownButton: some View {
        Button {
            Task { await markShownRead() }
        } label: {
            Label(
                filter.category == nil ? "Mark all as read" : "Mark this section as read",
                systemImage: "checkmark"
            )
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(Theme.accent)
        }
        .buttonStyle(.plain)
        .disabled(markingShown)
    }

    @ViewBuilder private var content: some View {
        if let inbox = shown {
            if failures.contains(filter) { staleNotice }
            if inbox.notifications.isEmpty {
                DashedEmpty(
                    title: "You're all caught up",
                    hint: "Grades, assignments and reminders will appear here."
                )
            } else {
                list(inbox.notifications)
            }
        } else if failures.contains(filter) {
            failure
        } else {
            placeholder
        }
    }

    private func list(_ rows: [AppNotification]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().padding(.leading, 36) }
                Button { open(row) } label: {
                    NotificationRow(notification: row)
                }
                .buttonStyle(.plain)
            }
        }
        .cardStyle(padding: 0)
    }

    /// Nothing loaded, and the load failed.
    private var failure: some View {
        ContentUnavailableView {
            Label("Notifications aren't loading.", systemImage: "wifi.exclamationmark")
        } description: {
            Text("Nothing has been missed — the list just couldn't be fetched.")
        } actions: {
            Button("Try again") { Task { await load() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(.top, 12)
    }

    /// A list from earlier is on screen, and refreshing it failed. The list stays — it is still
    /// true as far as it goes — and the failure is said above it.
    private var staleNotice: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.warning)
            Text("Notifications aren't loading.")
                .font(.system(size: 13, weight: .bold))
            Spacer(minLength: 8)
            Button("Try again") { Task { await load() } }
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(Theme.accent)
                .buttonStyle(.plain)
        }
        .cardStyle(padding: 12)
    }

    /// Three rows' worth of shape while the first answer is on its way — the web's skeletons.
    private var placeholder: some View {
        VStack(spacing: 0) {
            ForEach(0..<3, id: \.self) { index in
                if index > 0 { Divider().padding(.leading, 36) }
                NotificationRow(notification: .placeholder)
            }
        }
        .redacted(reason: .placeholder)
        .allowsHitTesting(false)
        .cardStyle(padding: 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading notifications")
    }

    // MARK: - Actions

    private func load() async {
        let key = filter
        do {
            let fresh = try await api.list(category: key.category)
            inboxes[key] = fresh
            if !fresh.categories.isEmpty { sections = fresh.categories }
            counts.applyUnread(fresh.summary)
            failures.remove(key)
        } catch {
            // Leaving a chip cancels its load; that is not a failure to report.
            if Task.isCancelled { return }
            failures.insert(key)
        }
    }

    private func open(_ row: AppNotification) {
        if !row.isRead { markRead(row) }
        guard let link = row.link else { return }
        onOpen(link)
        dismiss()
    }

    /// One row: read at once on screen, then on the server. The server's answer carries the new
    /// counts, which correct the bell whichever way the request went.
    private func markRead(_ row: AppNotification) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        for key in Array(inboxes.keys) {
            guard var inbox = inboxes[key] else { continue }
            inbox.notifications = inbox.notifications.map { $0.id == row.id ? $0.markedRead(at: stamp) : $0 }
            inboxes[key] = inbox
        }
        counts.noteRead(category: row.category)
        let api = self.api
        let counts = self.counts
        let id = row.id
        // Not tied to this view: the row is often tapped on the way out of the sheet.
        Task {
            if let result = try? await api.markRead(ids: [id]) {
                counts.applyUnread(result.summary)
            }
        }
    }

    /// "Mark all as read" / "Mark this section as read".
    private func markShownRead() async {
        let category = filter.category
        markingShown = true
        defer { markingShown = false }

        let stamp = ISO8601DateFormatter().string(from: Date())
        for key in Array(inboxes.keys) {
            guard var inbox = inboxes[key] else { continue }
            inbox.notifications = inbox.notifications.map { row in
                category == nil || row.category == category ? row.markedRead(at: stamp) : row
            }
            inboxes[key] = inbox
        }
        do {
            let result: MarkReadResult
            if let category {
                result = try await api.markRead(category: category)
            } else {
                result = try await api.markAllRead()
            }
            counts.applyUnread(result.summary)
        } catch {
            // The reload below shows the truth: rows the server did not mark come back unread.
        }
        await load()
    }
}

/// One notification: the unread dot, the title, the body on one line, then
/// "{section} · {when}" — the web's row, in the same order and the same words.
private struct NotificationRow: View {
    let notification: AppNotification

    private var meta: String {
        let when = NotificationTime.ago(notification.createdAt)
        return when.isEmpty ? notification.categoryLabel : "\(notification.categoryLabel) · \(when)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(notification.isRead ? Color.clear : Theme.accent)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 3) {
                Text(notification.title)
                    .font(.system(size: 15, weight: notification.isRead ? .semibold : .heavy))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if !notification.body.isEmpty {
                    Text(notification.body)
                        .font(.system(size: 13, weight: notification.isRead ? .medium : .bold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Text(meta)
                    .font(.system(size: 11, weight: notification.isRead ? .semibold : .heavy))
                    .foregroundStyle(Theme.textLabel)
            }
            Spacer(minLength: 0)
            if notification.link != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textLabel)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(notification.isRead ? "" : "Unread")
    }
}

private extension AppNotification {
    /// The shape of a row, for the loading skeleton. Never shown as text.
    static let placeholder = AppNotification(
        id: 0,
        category: "GRADES",
        categoryLabel: "Grades",
        event: "",
        title: "Your homework has been marked",
        body: "Reading and writing · Senior A",
        createdAt: ""
    )
}
