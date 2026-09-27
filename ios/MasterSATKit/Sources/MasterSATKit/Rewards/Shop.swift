import Foundation

/// The two shelves. Every item is priced in coins **or** strikes, never both.
public enum ShopShelf: String, Sendable, Hashable, CaseIterable {
    case coin = "COIN"
    case strike = "STRIKE"
}

/// One thing on a shelf.
public struct ShopItem: Decodable, Identifiable, Sendable, Equatable {
    public let id: Int
    public let name: String
    public let description: String
    /// Signed and expiring (about an hour) — load it, never persist it.
    public let imageURL: String?
    /// `COIN` / `STRIKE`.
    public let currency: String
    public let currencyLabel: String
    public let price: Int
    /// Signed: a stock correction can take it below zero.
    public let stock: Int
    public let inStock: Bool
    public let isActive: Bool
    public let sortOrder: Int
    /// The server's answer to "can I buy this now": enough of the currency AND in stock.
    public let affordable: Bool
    /// How many more of the currency are needed. Computed by the server; the shop never does
    /// currency arithmetic of its own.
    public let shortBy: Int

    public init(
        id: Int,
        name: String,
        description: String = "",
        imageURL: String? = nil,
        currency: String = ShopShelf.coin.rawValue,
        currencyLabel: String = "Coins",
        price: Int,
        stock: Int,
        inStock: Bool? = nil,
        isActive: Bool = true,
        sortOrder: Int = 0,
        affordable: Bool? = nil,
        shortBy: Int = 0
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.imageURL = imageURL
        self.currency = currency
        self.currencyLabel = currencyLabel
        self.price = price
        self.stock = stock
        let stocked = inStock ?? (stock > 0)
        self.inStock = stocked
        self.isActive = isActive
        self.sortOrder = sortOrder
        self.affordable = affordable ?? (stocked && shortBy == 0)
        self.shortBy = max(0, shortBy)
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, currency, price, stock, affordable
        case imageURL = "image_url"
        case currencyLabel = "currency_label"
        case inStock = "in_stock"
        case isActive = "is_active"
        case sortOrder = "sort_order"
        case shortBy = "short_by"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(Int.self, forKey: .id),
            name: c.rewardsString(.name) ?? "",
            description: c.rewardsString(.description) ?? "",
            imageURL: c.rewardsString(.imageURL).flatMap { $0.isEmpty ? nil : $0 },
            currency: c.rewardsString(.currency) ?? ShopShelf.coin.rawValue,
            currencyLabel: c.rewardsString(.currencyLabel) ?? "",
            price: c.rewardsInt(.price) ?? 0,
            stock: c.rewardsInt(.stock) ?? 0,
            inStock: c.rewardsBool(.inStock),
            isActive: c.rewardsBool(.isActive) ?? true,
            sortOrder: c.rewardsInt(.sortOrder) ?? 0,
            affordable: c.rewardsBool(.affordable),
            shortBy: c.rewardsInt(.shortBy) ?? 0
        )
    }

    public var shelf: ShopShelf { currency.uppercased() == ShopShelf.strike.rawValue ? .strike : .coin }
    public var isCoin: Bool { shelf == .coin }

    /// "coin" or "strike" — for "N more coins".
    public var unit: String { isCoin ? "coin" : "strike" }

    /// "5 coins", "1 strike".
    public var priceText: String { RewardsFormat.count(price, unit) }

    public var buttonTitle: String { inStock ? "Buy" : "Sold out" }

    /// Whether Buy is live. The server decides; this only reads its answer.
    public var canBuy: Bool { affordable && inStock }

    /// The line under the price. Never "you can't afford this": it says what is still needed,
    /// which is a thing the student can go and do.
    public var status: Status {
        if !inStock { return .outOfStock }
        if shortBy > 0 { return .needsMore(RewardsFormat.count(shortBy, "more \(unit)", "more \(unit)s")) }
        return .left(stock)
    }

    public enum Status: Sendable, Equatable {
        case outOfStock
        /// The emphasised half ("3 more coins"); the screen adds " and it's yours."
        case needsMore(String)
        case left(Int)

        /// The whole line as plain text.
        public var text: String {
            switch self {
            case .outOfStock: return "Out of stock — check back soon."
            case .needsMore(let amount): return "\(amount) and it's yours."
            case .left(let stock): return "\(stock) left"
            }
        }
    }
}

/// `GET /api/shop/` — both balances and both shelves in one answer, so a student deciding
/// between a coin item and a strike item never sees the page half-informed.
public struct Storefront: Decodable, Sendable, Equatable {
    public let coins: Int
    /// Coins the student's unconverted points would buy — "N more to convert".
    public let convertibleCoins: Int
    public let strikes: Int
    public let currentStreak: Int
    public let bestStreak: Int
    public let coinItems: [ShopItem]
    public let strikeItems: [ShopItem]

    public init(
        coins: Int,
        convertibleCoins: Int = 0,
        strikes: Int,
        currentStreak: Int = 0,
        bestStreak: Int = 0,
        coinItems: [ShopItem] = [],
        strikeItems: [ShopItem] = []
    ) {
        self.coins = coins
        self.convertibleCoins = convertibleCoins
        self.strikes = strikes
        self.currentStreak = currentStreak
        self.bestStreak = bestStreak
        self.coinItems = coinItems
        self.strikeItems = strikeItems
    }

    enum CodingKeys: String, CodingKey {
        case coins, strikes
        case convertibleCoins = "convertible_coins"
        case currentStreak = "current_streak"
        case bestStreak = "best_streak"
        case coinItems = "coin_items"
        case strikeItems = "strike_items"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            coins: try c.rewardsRequiredInt(.coins),
            convertibleCoins: c.rewardsInt(.convertibleCoins) ?? 0,
            strikes: try c.rewardsRequiredInt(.strikes),
            currentStreak: c.rewardsInt(.currentStreak) ?? 0,
            bestStreak: c.rewardsInt(.bestStreak) ?? 0,
            coinItems: try c.rewardsList(ShopItem.self, .coinItems),
            strikeItems: try c.rewardsList(ShopItem.self, .strikeItems)
        )
    }

    public func items(on shelf: ShopShelf) -> [ShopItem] {
        shelf == .coin ? coinItems : strikeItems
    }

    /// Where the page opens: on a shelf with something on it. An unstocked coin shop beside a
    /// stocked strike shop should not greet anybody with "Nothing here yet".
    public var openingShelf: ShopShelf {
        coinItems.isEmpty && !strikeItems.isEmpty ? .strike : .coin
    }

    /// Under the Coins balance, only when there are points waiting to be converted.
    public var coinsLine: String? {
        convertibleCoins > 0 ? "\(convertibleCoins) more to convert" : nil
    }

    /// Under the Strikes balance: the run it comes from.
    public var strikesLine: String {
        currentStreak > 0
            ? "\(RewardsFormat.count(currentStreak, "lesson")) in a row"
            : "Attend a lesson to start a run"
    }
}

/// Something bought, waiting at (or already handed over from) the desk.
public struct ShopOrder: Decodable, Identifiable, Sendable, Equatable {
    public static let pending = "PENDING"
    public static let fulfilled = "FULFILLED"
    public static let cancelled = "CANCELLED"

    public let id: Int
    public let itemId: Int?
    /// Frozen at purchase: a renamed item does not rewrite old orders.
    public let itemName: String
    public let imageURL: String?
    public let currency: String
    public let price: Int
    public let status: String
    /// "Waiting to be handed over" / "Handed over" / "Cancelled and refunded" — the server's.
    public let statusLabel: String
    public let note: String
    /// `+05:00`, microseconds when present.
    public let createdAt: String
    public let settledAt: String?

    enum CodingKeys: String, CodingKey {
        case id, currency, price, status, note
        case itemId = "item"
        case itemName = "item_name"
        case imageURL = "image_url"
        case statusLabel = "status_label"
        case createdAt = "created_at"
        case settledAt = "settled_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        itemId = c.rewardsInt(.itemId)
        itemName = c.rewardsString(.itemName) ?? ""
        imageURL = c.rewardsString(.imageURL).flatMap { $0.isEmpty ? nil : $0 }
        currency = c.rewardsString(.currency) ?? ShopShelf.coin.rawValue
        price = c.rewardsInt(.price) ?? 0
        let status = (c.rewardsString(.status) ?? Self.pending).uppercased()
        self.status = status
        let label = c.rewardsString(.statusLabel) ?? ""
        statusLabel = label.isEmpty ? Self.fallbackLabel(status) : label
        note = c.rewardsString(.note) ?? ""
        createdAt = c.rewardsString(.createdAt) ?? ""
        settledAt = c.rewardsString(.settledAt).flatMap { $0.isEmpty ? nil : $0 }
    }

    public var shelf: ShopShelf { currency.uppercased() == ShopShelf.strike.rawValue ? .strike : .coin }

    /// "1 coin", "4 strikes" — the web's orders list used to say "1 coins".
    public var priceText: String { RewardsFormat.count(price, shelf == .coin ? "coin" : "strike") }

    public var createdDate: Date? { JSONCoding.parseServerDate(createdAt) }

    /// "Sep 25 · 5 coins · {note}", with the date already written by the caller.
    public func detailLine(date: String) -> String {
        [date, priceText, note].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func fallbackLabel(_ status: String) -> String {
        switch status {
        case fulfilled: return "Handed over"
        case cancelled: return "Cancelled and refunded"
        default: return "Waiting to be handed over"
        }
    }
}

/// `POST /api/shop/items/<id>/purchase/` → 201.
public struct ShopPurchase: Decodable, Sendable {
    /// "Ordered. Collect your {name} from the desk." — for display only.
    public let detail: String
    public let order: ShopOrder?

    enum CodingKeys: String, CodingKey { case detail, order }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        detail = c.rewardsString(.detail) ?? ""
        order = try? c.decodeIfPresent(ShopOrder.self, forKey: .order)
    }
}

/// The storefront, buying, and the student's own orders.
public struct ShopAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func storefront() async throws -> Storefront {
        try await client.send(.get("/shop/"), as: Storefront.self)
    }

    /// Buy one. Takes the currency and a unit of stock at once and returns a PENDING order.
    ///
    /// **Not idempotent.** A second call is a second order — the server has no key to dedupe
    /// on. Confirm first, disable every Buy while one is in flight, and never retry this
    /// automatically. A refusal (400) carries a sentence worth showing in `detail`.
    public func purchase(itemId: Int) async throws -> ShopPurchase {
        try await client.send(.post("/shop/items/\(itemId)/purchase/"), as: ShopPurchase.self)
    }

    /// Newest first, at most 50.
    public func orders() async throws -> [ShopOrder] {
        try await client.send(.get("/shop/orders/"), as: OrdersEnvelope.self).orders
    }
}

private struct OrdersEnvelope: Decodable, Sendable {
    let orders: [ShopOrder]

    enum CodingKeys: String, CodingKey { case orders }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        orders = try c.rewardsList(ShopOrder.self, .orders)
    }
}
