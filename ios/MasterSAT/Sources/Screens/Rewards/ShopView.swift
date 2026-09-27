import SwiftUI
import MasterSATKit

/// The shop — the native counterpart of the site's `/shop`: what a student has to spend, the
/// two shelves they spend it on, and the orders waiting for them at the desk.
///
/// **A purchase cannot be undone by the student and is not idempotent** — a double tap on the
/// web is two orders. So here: every purchase is confirmed first, every Buy on the page is off
/// while one is in flight, nothing is retried, and the answer lands in a toast wherever the
/// student has scrolled to. Afterwards the storefront and orders are read back, because
/// balances, stock and the order list all move together.
struct ShopView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var shop: Storefront?
    @State private var shopFailed = false
    @State private var orders: [ShopOrder]?
    @State private var ordersFailed = false
    /// Nil until the student picks a tab; until then the page opens on a stocked shelf.
    @State private var picked: ShopShelf?
    @State private var confirming: ShopItem?
    @State private var purchasingId: Int?
    @State private var toast: RewardsToastMessage?

    private var shelf: ShopShelf { picked ?? shop?.openingShelf ?? .coin }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ShopHero(shop: shop, failed: shopFailed && shop == nil, wide: sizeClass == .regular)

                if shopFailed && shop == nil {
                    RewardsErrorState(
                        title: "The shop isn't loading right now.",
                        message: "Your coins and strikes are safe — only this page failed to load."
                    ) { await load() }
                    .cardStyle(padding: 8)
                } else {
                    shelves
                }

                ordersSection
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert(
            confirming.map { Text(verbatim: "Buy \($0.name)?") } ?? Text(verbatim: ""),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { item in
            Button("Buy") { Task { await buy(item) } }
            Button("Cancel", role: .cancel) {}
        } message: { item in
            Text(verbatim: "This spends \(item.priceText). You'll collect it from the desk.")
        }
        .rewardsToast($toast)
    }

    // MARK: - Shelves

    private static func blurb(_ shelf: ShopShelf) -> String {
        shelf == .coin
            ? "Bought with coins, converted from your points."
            : "Bought with strikes — one for every lesson in your current run."
    }

    private static func emptyHint(_ shelf: ShopShelf) -> String {
        shelf == .coin
            ? "Your learning center hasn't stocked the coin shop yet."
            : "Your learning center hasn't stocked the strike shop yet."
    }

    /// One tab per currency, each with its count, so a long coin shelf never buries the strike
    /// shop underneath it.
    private var shelves: some View {
        VStack(alignment: .leading, spacing: 14) {
            PillTabs(
                items: [
                    .init(tab: ShopShelf.coin, title: "Coin shop", icon: "circle.circle", count: shop?.coinItems.count),
                    .init(tab: ShopShelf.strike, title: "Strike shop", icon: "flame", count: shop?.strikeItems.count),
                ],
                selection: Binding(get: { shelf }, set: { picked = $0 })
            )

            Text(Self.blurb(shelf))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)

            if let shop {
                let items = shop.items(on: shelf)
                if items.isEmpty {
                    DashedEmpty(title: "Nothing here yet", hint: Self.emptyHint(shelf))
                } else {
                    // One column on a phone, as on the web below 640px; more where there is room.
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                        ForEach(items) { item in
                            ShopItemCard(
                                item: item,
                                busy: purchasingId != nil,
                                buying: purchasingId == item.id
                            ) {
                                confirming = item
                            }
                        }
                    }
                }
            } else {
                // The card's own silhouette, so the swap to live items does not reflow.
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                    ForEach(0..<2, id: \.self) { _ in ShopItemSkeleton() }
                }
                .accessibilityLabel("Loading the shop")
            }
        }
    }

    // MARK: - Orders

    private var ordersHeader: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Your orders")
                .font(.system(size: 20, weight: .heavy))
                .tracking(-0.3)
                .accessibilityAddTraits(.isHeader)
            Text("Collect them from the desk")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    @ViewBuilder private var ordersSection: some View {
        if let orders, !orders.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ordersHeader
                VStack(spacing: 0) {
                    ForEach(Array(orders.enumerated()), id: \.element.id) { index, order in
                        if index > 0 { Divider().padding(.leading, 74) }
                        ShopOrderRow(order: order)
                    }
                }
                .cardStyle(padding: 0)
            }
        } else if ordersFailed && orders == nil {
            // The web hides the list when it fails. Said here instead: a student who just
            // bought something and sees no orders would read that as the purchase vanishing.
            VStack(alignment: .leading, spacing: 12) {
                ordersHeader
                RewardsErrorState(
                    title: "Your orders aren't loading right now.",
                    message: "Anything you've bought is safe — only this list failed to load."
                ) { await loadOrders() }
                .cardStyle(padding: 8)
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let storefront: Void = loadShop()
        async let mine: Void = loadOrders()
        _ = await (storefront, mine)
    }

    @MainActor
    private func loadShop() async {
        let api = ShopAPI(client: session.client)
        do {
            shop = try await api.storefront()
            shopFailed = false
        } catch {
            shopFailed = true
        }
    }

    @MainActor
    private func loadOrders() async {
        let api = ShopAPI(client: session.client)
        do {
            orders = try await api.orders()
            ordersFailed = false
        } catch {
            ordersFailed = true
        }
    }

    // MARK: - Buying

    /// One purchase per confirmation. Every Buy stays off until the storefront has been read
    /// back, so a second press can only ever be a second, deliberate, confirmed order.
    @MainActor
    private func buy(_ item: ShopItem) async {
        guard purchasingId == nil else { return }
        purchasingId = item.id
        let api = ShopAPI(client: session.client)
        do {
            let result = try await api.purchase(itemId: item.id)
            toast = RewardsToastMessage(
                tone: .success,
                text: result.detail.isEmpty ? "Ordered. Collect your \(item.name) from the desk." : result.detail
            )
        } catch {
            toast = RewardsToastMessage(tone: .notice, text: Self.refusal(error))
        }
        await load()
        purchasingId = nil
    }

    /// The server's own sentence where it sent one — "Not enough coins: 3 available, 5
    /// needed." says what is missing — and the web's fallback otherwise.
    private static func refusal(_ error: Error) -> String {
        if let error = error as? APIError {
            switch error {
            case .http(_, let detail) where !detail.isEmpty: return detail
            case .forbidden(let detail, _) where !detail.isEmpty: return detail
            case .validation(let detail, _, _) where !detail.isEmpty: return detail
            case .conflict(let detail) where !detail.isEmpty: return detail
            default: break
            }
        }
        return "That didn't go through. Nothing was taken."
    }
}

// MARK: - Hero

/// The shop's header — on the web it is the white "quartz" panel, not the blue banner, with the
/// two currencies as one thin edge: the coin's blue running into the strike's amber.
private struct ShopHero: View {
    let shop: Storefront?
    let failed: Bool
    let wide: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 14) {
                IconTile(systemName: "bag.fill", tone: Theme.accent, size: 56)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Shop")
                        .font(.system(size: 28, weight: .heavy))
                        .tracking(-0.7)
                        .accessibilityAddTraits(.isHeader)
                    Text("Spend what you've earned. Coins keep; strikes don't — miss a lesson and they're gone.")
                        .font(.system(size: 14.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let shop {
                balances(shop)
            } else if !failed {
                balancesPlaceholder
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) {
            LinearGradient(
                colors: [Theme.accent, Theme.accent.opacity(0.5), Theme.warning],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(height: 4)
            .allowsHitTesting(false)
        }
        .cardStyle(padding: 0)
    }

    @ViewBuilder private func balances(_ shop: Storefront) -> some View {
        let coins = ShopBalance(label: "Coins", value: shop.coins, sub: shop.coinsLine, watermark: "circle.circle") {
            RewardsCoinArt(kind: .coin, size: 40)
        }
        // The spendable balance leads; the run it comes from is the line underneath.
        let strikes = ShopBalance(label: "Strikes", value: shop.strikes, sub: shop.strikesLine, watermark: "flame") {
            ShopStrikeGlyph(size: 40)
        }
        if wide {
            HStack(spacing: 12) { coins; strikes }
        } else {
            VStack(spacing: 12) { coins; strikes }
        }
    }

    private var balancesPlaceholder: some View {
        VStack(spacing: 12) {
            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Theme.surface2)
                    .frame(height: 76)
            }
        }
        .accessibilityLabel("Loading your balances")
    }
}

/// One balance on the hero, with its currency faint in the corner.
private struct ShopBalance<Media: View>: View {
    let label: String
    let value: Int
    var sub: String?
    let watermark: String
    @ViewBuilder var media: () -> Media

    var body: some View {
        HStack(spacing: 14) {
            media()
            VStack(alignment: .leading, spacing: 4) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(Theme.textSecondary)
                Text(ScoreText.string(value))
                    .font(.system(size: 26, weight: .heavy))
                    .monospacedDigit()
                if let sub {
                    Text(sub)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.background)
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: watermark)
                .font(.system(size: 60, weight: .light))
                .foregroundStyle(Color.primary.opacity(0.05))
                .offset(x: 8, y: 14)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Theme.separator.opacity(0.5), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
    }
}

/// The strike's own mark — a flame on the amber the web gives the strike shop.
private struct ShopStrikeGlyph: View {
    var size: CGFloat = 40

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Theme.amberSoft)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "flame.fill")
                    .font(.system(size: size * 0.48, weight: .semibold))
                    .foregroundStyle(Theme.amber)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Items

/// One thing on a shelf. The card itself is not tappable — its Buy button is.
private struct ShopItemCard: View {
    let item: ShopItem
    /// Some purchase is in flight: every Buy on the page is off.
    let busy: Bool
    /// This one is the purchase in flight.
    let buying: Bool
    let onBuy: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ShopItemImage(url: item.imageURL, shelf: item.shelf)

            VStack(alignment: .leading, spacing: 0) {
                Text(item.name)
                    .font(.system(size: 15.5, weight: .heavy))
                    .fixedSize(horizontal: false, vertical: true)
                if !item.description.isEmpty {
                    Text(item.description)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                        .padding(.top, 4)
                }

                HStack(spacing: 12) {
                    HStack(spacing: 6) {
                        if item.isCoin {
                            RewardsCoinArt(kind: .coin, size: 22)
                        } else {
                            Image(systemName: "flame.fill")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(Color.orange)
                        }
                        Text(ScoreText.string(item.price))
                            .font(.system(size: 18, weight: .heavy))
                            .monospacedDigit()
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(item.priceText)

                    Spacer(minLength: 8)

                    Button(action: onBuy) {
                        ZStack {
                            // Keeps the pill the width of its title while the spinner shows.
                            Text(item.buttonTitle).opacity(buying ? 0 : 1)
                            if buying { ProgressView().controlSize(.small).tint(.white) }
                        }
                    }
                    .buttonStyle(ShopBuyButtonStyle())
                    .disabled(!item.canBuy || busy)
                    .accessibilityLabel(item.inStock ? "Buy \(item.name) for \(item.priceText)" : "\(item.name), sold out")
                }
                .padding(.top, 16)

                statusLine.padding(.top, 10)
            }
            .padding(.horizontal, 10)
            .padding(.top, 14)
            .padding(.bottom, 6)
        }
        .cardStyle(padding: 8)
    }

    /// Never "you can't afford this": what is still needed, which a student can go and do.
    @ViewBuilder private var statusLine: some View {
        Group {
            switch item.status {
            case .needsMore(let amount):
                Text("\(Text(amount).fontWeight(.heavy).foregroundStyle(Color.primary)) and it's yours.")
            case .outOfStock, .left:
                Text(item.status.text)
            }
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(Theme.textSecondary)
    }
}

/// The item's picture at 4:3, or a bag on the shelf's own tint. The URL is signed and
/// expires in about an hour, so it is loaded each time, never kept.
private struct ShopItemImage: View {
    let url: String?
    let shelf: ShopShelf

    var body: some View {
        Color.clear
            .aspectRatio(4 / 3, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                if let url, let address = URL(string: url) {
                    AsyncImage(url: address) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else if phase.error != nil {
                            ShopBagTile(shelf: shelf, glyph: 36)
                        } else {
                            Theme.surface2.overlay(ProgressView())
                        }
                    }
                } else {
                    ShopBagTile(shelf: shelf, glyph: 36)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A bag on the currency's tint — an item or an order with no picture.
private struct ShopBagTile: View {
    let shelf: ShopShelf
    var glyph: CGFloat = 20

    var body: some View {
        ZStack {
            shelf == .coin ? Theme.accentSoft : Theme.amberSoft
            Image(systemName: "bag")
                .font(.system(size: glyph, weight: .medium))
                .foregroundStyle(shelf == .coin ? RewardsPalette.accentText : Theme.amber)
                .opacity(0.85)
        }
    }
}

/// The house pill, on the web's Buy: filled when it can be pressed, quiet when it cannot.
private struct ShopBuyButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration)
    }

    private struct Styled: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.system(size: 13, weight: .heavy))
                .foregroundStyle(isEnabled ? Color.white : Theme.textSecondary)
                .padding(.horizontal, 20)
                .frame(minHeight: 36)
                .background(Capsule().fill(isEnabled ? Theme.accent : Theme.surface2))
                .shadow(color: isEnabled ? Theme.accent.opacity(0.35) : .clear, radius: 6, x: 0, y: 4)
                .opacity(configuration.isPressed ? 0.85 : 1)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
        }
    }
}

private struct ShopItemSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.surface2)
                .aspectRatio(4 / 3, contentMode: .fit)
            RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(width: 160, height: 14)
            RoundedRectangle(cornerRadius: 4).fill(Theme.surface2).frame(height: 12)
            HStack {
                Capsule().fill(Theme.surface2).frame(width: 56, height: 22)
                Spacer()
                Capsule().fill(Theme.surface2).frame(width: 72, height: 36)
            }
        }
        .padding(.bottom, 6)
        .cardStyle(padding: 8)
    }
}

// MARK: - Orders

private struct ShopOrderRow: View {
    let order: ShopOrder

    private var tone: Chip.Tone {
        switch order.status {
        case ShopOrder.fulfilled: return .success
        case ShopOrder.cancelled: return .neutral
        default: return .accent
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            thumbnail
            VStack(alignment: .leading, spacing: 3) {
                Text(order.itemName)
                    .font(.system(size: 14.5, weight: .heavy))
                    .lineLimit(1)
                Text(order.detailLine(date: RewardsDate.short(order.createdAt)))
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            Chip(text: order.statusLabel, tone: tone)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }

    private var thumbnail: some View {
        Group {
            if let url = order.imageURL, let address = URL(string: url) {
                AsyncImage(url: address) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        ShopBagTile(shelf: order.shelf)
                    }
                }
            } else {
                ShopBagTile(shelf: order.shelf)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .accessibilityHidden(true)
    }
}
