import SwiftUI
import MasterSATKit

// Today's sections in the new look (mockups 10 and 17, with the owner's changes of 2026-10-28):
// the wordmark on the band, the Daily Challenge slot, the compact Up next, Services and the Shop
// rail. Everything here opens what the app already has; nothing is new on the server.

// MARK: - The wordmark

/// MASTER SAT beside the shield — the kit's `logo-wordmark.png`, drawn from the app's own brand
/// mark and the display face, so it stays sharp at every size and needs no second picture.
struct BrandWordmark: View {
    var body: some View {
        HStack(spacing: 8) {
            BrandMark(height: 50)
            VStack(alignment: .leading, spacing: -3) {
                Text(verbatim: "MASTER")
                Text(verbatim: "SAT")
            }
            .appDisplayFont(23)
            .tracking(-0.2)
            .foregroundStyle(.white)
            // Chrome on a fixed band: it stops growing where the row still fits.
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Master SAT")
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - The Daily Challenge slot

/// Where the Daily Challenge goes — right under the stat cards (owner's order).
///
/// **Renders nothing for now.** The owner builds the Daily Challenge (its API and its card) in
/// another session; when it lands, its card is mounted here and nowhere else. Zero points tall
/// until then, so Today's `SlotStack` leaves no gap for it.
struct DailyChallengeSlot: View {
    var body: some View {
        // Integration point: replace with the Daily Challenge card once that feature exists.
        Color.clear.frame(height: 0).accessibilityHidden(true)
    }
}

// MARK: - Up next, compact

/// Up next in one white card: one-line rows (tile · title · due chip · chevron), at most three
/// (`UpNextCompact`), "up to +15 XP" only where the homework still pays.
struct CompactUpNextList<Row: View>: View {
    let items: [WorkItem]
    @ViewBuilder let row: (WorkItem) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 {
                    Rectangle().fill(NewLook.line).frame(height: 1).padding(.leading, 56)
                }
                row(item)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity)
        .newLookSurface(NewLook.card, radius: 22, shadow: .tile)
    }
}

/// One line of Up next. The detail ("SAT Math · M-14 · 1 quiz") is left to the page it opens;
/// VoiceOver still hears it.
struct CompactWorkRow: View {
    let item: WorkItem

    private var visual: (icon: String, tone: NewLook.Tone) {
        switch item.look {
        case .quiz: ("square.and.pencil", .green)
        case .words: ("character.book.closed.fill", .violet)
        case .paper: ("doc.text.fill", .sky)
        case .handIn: ("tray.and.arrow.up.fill", .blue)
        case .lesson: ("person.2.fill", .blue)
        case .exam: ("list.clipboard.fill", .orange)
        }
    }

    private var chip: UpNextCompact.Chip? {
        UpNextCompact.chip(for: item, now: .now, calendar: ServicesTime.calendar)
    }

    var body: some View {
        HStack(spacing: 12) {
            NewLookTile(systemName: visual.icon, tone: visual.tone, small: true)
            Text(item.title)
                .appFont(15, weight: .bold)
                .foregroundStyle(NewLook.ink)
                .lineLimit(1)
                .layoutPriority(1)
            Spacer(minLength: 4)
            if let xp = UpNextCompact.xpChip(for: item) {
                NewLookChip(text: xp, systemImage: "bolt.fill", style: .orange)
            }
            if let chip {
                NewLookChip(
                    text: chip.text,
                    systemImage: chip.tone == .catchUp ? "clock.arrow.circlepath" : nil,
                    style: chip.tone == .catchUp ? .orange : (chip.tone == .lesson ? .blue : .gray)
                )
            }
            if item.assignment != nil || item.lessonClassroomId != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(NewLook.chevron)
                    .accessibilityHidden(true)
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .frame(minHeight: 54)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private var spoken: String {
        [item.title, item.detail, chip?.spoken, UpNextCompact.xpChip(for: item).map { "worth \($0)" }]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}

extension WorkItem {
    /// The class a lesson row opens, if the schedule named one.
    var lessonClassroomId: Int? {
        if case .lesson(let event) = source { return event.classroomId }
        return nil
    }
}

// MARK: - Services

/// The three service tiles (mockup 10). Each opens a page the app already has.
struct TodayServicesRow: View {
    let onSupport: () -> Void
    let onRegistration: () -> Void
    let onFAQ: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NewLookSectionHeader(title: "Services")
            StatCardsGrid(spacing: 10, columns: 3) {
                ServiceTile(title: "Support Teacher", systemImage: "bubble.left.and.bubble.right.fill",
                            hint: "Opens support booking", action: onSupport)
                ServiceTile(title: "SAT Registration", systemImage: "ticket.fill",
                            hint: "Opens what you need to register for the SAT", action: onRegistration)
                ServiceTile(title: "SAT FAQ", systemImage: "questionmark.circle.fill",
                            hint: "Opens Services", action: onFAQ)
            }
        }
    }
}

/// `.svc`: a white tile, its icon tile on top and the name under it.
struct ServiceTile: View {
    let title: String
    let systemImage: String
    var tone: NewLook.Tone = .blue
    let hint: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                NewLookTile(systemName: systemImage, tone: tone)
                // Two lines at most: a word too long for a narrow tile shrinks a little rather
                // than break mid-word ("Registratio / n").
                Text(title)
                    .appFont(15, weight: .bold)
                    .foregroundStyle(NewLook.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .newLookSurface(NewLook.card, radius: 20, shadow: .tile)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressBounce())
        .accessibilityHint(hint)
    }
}

// MARK: - The Shop rail

/// The Shop rail: real items from the storefront (`/shop/`, `ShopRail.items`), a tap opens the
/// Shop. Loading shows the cards' shape; a failure says so with a retry — never "nothing here";
/// an empty shop says so plainly.
struct TodayShopRail: View {
    var refreshID: Int = 0
    let onOpenShop: () -> Void

    @Environment(Session.self) private var session
    @State private var items: [ShopItem] = []
    @State private var phase: Phase = .loading

    private enum Phase: Equatable { case loading, loaded, failed }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onOpenShop) {
                HStack(spacing: 12) {
                    RewardMedallion(kind: .shop, phase: 3.5, moves: false)
                    Text("Shop")
                        .appDisplayFont(17)
                        .tracking(-0.3)
                        .foregroundStyle(NewLook.ink)
                    Spacer(minLength: 0)
                    Text("See all")
                        .appFont(14, weight: .bold)
                        .foregroundStyle(NewLook.blueText)
                }
                .padding(.horizontal, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Shop")
            .accessibilityHint("Opens the Shop")
            .accessibilityAddTraits([.isHeader, .isButton])

            content
        }
        .task(id: refreshID) { await load() }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading where items.isEmpty:
            ScrollView(.horizontal, showsIndicators: false) {
                // The cards' own shape — the picture, a name, a price — with the kit's shimmer.
                SkeletonClock {
                    HStack(spacing: 10) {
                        ForEach(0..<3, id: \.self) { _ in
                            VStack(alignment: .leading, spacing: 10) {
                                SkeletonBlock(height: 92, radius: 14)
                                SkeletonLine(fraction: 0.8, height: 13)
                                SkeletonLine(fraction: 0.5, height: 11)
                            }
                            .padding(12)
                            .frame(width: 138, height: 176, alignment: .top)
                            .newLookSurface(NewLook.card, radius: 20, shadow: .shop)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .scrollDisabled(true)
            .padding(.horizontal, -16)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading the Shop")
        case .failed where items.isEmpty:
            // A failure is not an empty shop.
            RetryNotice(message: "The Shop didn't load.") { await load() }
        default:
            if items.isEmpty {
                Text("Nothing in the Shop yet — new things show up here.")
                    .appFont(13, weight: .medium)
                    .foregroundStyle(NewLook.muted)
                    .padding(.horizontal, 2)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(items) { item in
                            Button(action: onOpenShop) { ShopRailCard(item: item) }
                                .buttonStyle(PressBounce())
                                .accessibilityHint("Opens the Shop")
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 18)
                }
                .padding(.horizontal, -16)
                .noBarClearanceInRow()
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            let store = try await ShopAPI(client: session.client).storefront()
            guard !Task.isCancelled else { return }
            let fresh = ShopRail.items(store)
            if fresh != items { items = fresh }
            if phase != .loaded { phase = .loaded }
        } catch {
            // Leaving the tab cancels the read: not a failure. A refresh that fails over items
            // already shown keeps them.
            guard !Task.isCancelled else { return }
            if items.isEmpty, phase != .failed { phase = .failed }
        }
    }
}

/// One Shop card: the picture on its tint, the name on two lines, the price chip.
struct ShopRailCard: View {
    let item: ShopItem

    private var tint: Color { item.isCoin ? NewLook.blue50 : NewLook.violet50 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            picture
                .frame(height: 76)
                .frame(maxWidth: .infinity)
                .background(tint)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(item.name)
                .appFont(13.5, weight: .bold)
                .foregroundStyle(NewLook.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: 34, alignment: .topLeading)
            price
        }
        .padding(10)
        .frame(width: 138)
        .newLookSurface(NewLook.card, radius: 20, shadow: .shop)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.name), \(item.priceText)")
    }

    @ViewBuilder private var picture: some View {
        if let url = item.imageURL.flatMap(URL.init(string:)) {
            // Signed and short-lived: loaded, never kept.
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        Image(systemName: item.isCoin ? "gift.fill" : "flame.fill")
            .font(.system(size: 30, weight: .semibold))
            .foregroundStyle(item.isCoin ? NewLook.blueText : NewLook.violet)
    }

    private var price: some View {
        HStack(spacing: 5) {
            if item.isCoin {
                ShieldCoin(size: 18)
            } else {
                Image(systemName: "flame.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 18, height: 18)
                    .background(NewLook.blue, in: Circle())
            }
            Text(ShopRail.priceText(item))
                .appFont(12.5, weight: .heavy, monospacedDigits: true)
                .foregroundStyle(item.isCoin ? NewLook.bronzeInk : NewLook.blueDeep)
        }
        .padding(.leading, 4)
        .padding(.trailing, 10)
        .frame(height: 26)
        .background(item.isCoin ? NewLook.bronze50 : NewLook.blue50, in: Capsule())
    }
}
