import Foundation
import Testing
@testable import MasterSATKit

@Suite struct ShopAPITests {

    let config = APIConfig(baseURL: URL(string: "https://mastersat.uz")!, clientIdentifier: "ios/test")
    let server = StubServer()

    private func api() -> ShopAPI {
        ShopAPI(client: APIClient(
            config: config,
            storage: InMemoryTokenStorage(TokenPair(access: "A", refresh: "R")),
            session: server.session()
        ))
    }

    private static func item(
        _ id: Int, currency: String = "COIN", price: Int = 5, stock: Int = 4,
        inStock: Bool = true, affordable: Bool = true, shortBy: Int = 0, image: Any = NSNull()
    ) -> [String: Any] {
        [
            "id": id, "name": "Item \(id)", "description": "A thing", "image_url": image,
            "currency": currency, "currency_label": currency == "COIN" ? "Coins" : "Strikes",
            "price": price, "stock": stock, "in_stock": inStock, "is_active": true,
            "sort_order": 0, "affordable": affordable, "short_by": shortBy,
        ]
    }

    private static func order(_ id: Int, status: String = "PENDING", label: Any = "Waiting to be handed over",
                              currency: String = "COIN", price: Int = 5, note: String = "") -> [String: Any] {
        [
            "id": id, "student": 9, "student_name": "Madina", "item": 3, "item_name": "Notebook",
            "image_url": NSNull(), "currency": currency, "price": price, "status": status,
            "status_label": label, "note": note,
            "created_at": "2026-09-25T14:05:09.123456+05:00", "settled_at": NSNull(),
        ]
    }

    @Test("The storefront decodes both balances and both shelves")
    func storefrontDecodes() async throws {
        server.handler = { _ in
            .json([
                "coins": 3, "convertible_coins": 2, "strikes": 4, "current_streak": 6, "best_streak": 9,
                "coin_items": [
                    Self.item(1, price: 5, stock: 2, affordable: false, shortBy: 2, image: "https://r2.example/x.png?sig=a"),
                    // A stock correction can go below zero.
                    Self.item(2, price: 3, stock: -1, inStock: false, affordable: false),
                ],
                "strike_items": [Self.item(3, currency: "STRIKE", price: 2, stock: 5)],
            ])
        }
        let shop = try await api().storefront()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/shop/")
        #expect(shop.coins == 3)
        #expect(shop.strikes == 4)
        #expect(shop.coinItems.count == 2)
        #expect(shop.strikeItems.first?.shelf == .strike)
        #expect(shop.coinItems[0].imageURL == "https://r2.example/x.png?sig=a")
        #expect(shop.coinItems[1].stock == -1)
        #expect(shop.coinsLine == "2 more to convert")
        #expect(shop.strikesLine == "6 lessons in a row")
        #expect(shop.openingShelf == .coin)
    }

    @Test("The status line says what is still needed, never that it can't be had")
    func itemStatus() {
        let short = ShopItem(id: 1, name: "Pen", price: 5, stock: 2, affordable: false, shortBy: 2)
        #expect(short.status == .needsMore("2 more coins"))
        #expect(short.status.text == "2 more coins and it's yours.")
        #expect(short.buttonTitle == "Buy")
        #expect(!short.canBuy)

        let oneStrike = ShopItem(id: 2, name: "Sticker", currency: "STRIKE", price: 3, stock: 1, affordable: false, shortBy: 1)
        #expect(oneStrike.status.text == "1 more strike and it's yours.")
        #expect(oneStrike.priceText == "3 strikes")

        // Out of stock outranks being short: there is nothing to save up for.
        let gone = ShopItem(id: 3, name: "Hoodie", price: 50, stock: 0, inStock: false, affordable: false, shortBy: 20)
        #expect(gone.status.text == "Out of stock — check back soon.")
        #expect(gone.buttonTitle == "Sold out")
        #expect(!gone.canBuy)

        let ready = ShopItem(id: 4, name: "Notebook", price: 1, stock: 4, affordable: true)
        #expect(ready.status.text == "4 left")
        #expect(ready.canBuy)
        #expect(ready.priceText == "1 coin")
    }

    @Test("The page opens on a stocked shelf")
    func openingShelf() {
        let strikeOnly = Storefront(coins: 0, strikes: 2, strikeItems: [ShopItem(id: 1, name: "x", currency: "STRIKE", price: 1, stock: 1)])
        #expect(strikeOnly.openingShelf == .strike)
        #expect(Storefront(coins: 0, strikes: 0).openingShelf == .coin)
        let both = Storefront(coins: 1, strikes: 1,
                              coinItems: [ShopItem(id: 1, name: "a", price: 1, stock: 1)],
                              strikeItems: [ShopItem(id: 2, name: "b", currency: "STRIKE", price: 1, stock: 1)])
        #expect(both.openingShelf == .coin)
    }

    @Test("The balance lines: nothing to convert says nothing, and a run of one is singular")
    func balanceLines() {
        #expect(Storefront(coins: 1, convertibleCoins: 0, strikes: 0).coinsLine == nil)
        #expect(Storefront(coins: 1, strikes: 1, currentStreak: 1).strikesLine == "1 lesson in a row")
        #expect(Storefront(coins: 1, strikes: 0, currentStreak: 0).strikesLine == "Attend a lesson to start a run")
    }

    @Test("A purchase posts once and reads back the order and the server's sentence")
    func purchase() async throws {
        server.handler = { _ in
            .json(["detail": "Ordered. Collect your Notebook from the desk.", "order": Self.order(41)], status: 201)
        }
        let result = try await api().purchase(itemId: 7)
        #expect(result.detail == "Ordered. Collect your Notebook from the desk.")
        #expect(result.order?.status == ShopOrder.pending)
        #expect(result.order?.statusLabel == "Waiting to be handed over")

        #expect(server.requests.count == 1)
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://mastersat.uz/api/shop/items/7/purchase/")
    }

    @Test("A refused purchase keeps the server's words and is never retried")
    func purchaseRefused() async throws {
        server.handler = { _ in .json(["detail": "Not enough coins: 3 available, 5 needed."], status: 400) }
        do {
            _ = try await api().purchase(itemId: 7)
            Issue.record("A refused purchase must throw")
        } catch let APIError.http(status, detail) {
            #expect(status == 400)
            #expect(detail == "Not enough coins: 3 available, 5 needed.")
        }
        #expect(server.requests.count == 1)
    }

    @Test("Orders decode, newest first, with the web's detail line")
    func orders() async throws {
        server.handler = { _ in
            .json(["orders": [
                Self.order(3, note: "Blue one"),
                Self.order(2, status: "FULFILLED", label: "Handed over", currency: "STRIKE", price: 4),
                Self.order(1, status: "CANCELLED", label: NSNull(), price: 1,
                           note: "Strikes could not be refunded — the streak had already reset."),
            ]])
        }
        let orders = try await api().orders()
        #expect(server.requests.first?.url?.absoluteString == "https://mastersat.uz/api/shop/orders/")
        #expect(orders.map(\.id) == [3, 2, 1])
        #expect(orders[0].detailLine(date: "Sep 25") == "Sep 25 · 5 coins · Blue one")
        #expect(orders[0].createdDate != nil)
        #expect(orders[0].settledAt == nil)
        #expect(orders[1].priceText == "4 strikes")
        #expect(orders[1].detailLine(date: "Sep 25") == "Sep 25 · 4 strikes")
        // A label the server left out falls back to its own wording, never to the raw code.
        #expect(orders[2].statusLabel == "Cancelled and refunded")
        #expect(orders[2].priceText == "1 coin")
    }

    @Test("A storefront with no balances is a failure, not an empty wallet")
    func storefrontRequiresBalances() async throws {
        server.handler = { _ in .json(["coin_items": [], "strike_items": []]) }
        await #expect(throws: APIError.self) { try await api().storefront() }
    }
}
