import SwiftUI
import MasterSATKit

/// Points, coins and XP — the native counterpart of the site's `/rewards` page.
///
/// **Points are spent now.** They used to turn into coins on their own; now a student presses
/// Convert, chooses how many, and the points leave the balance (a negative `COIN_CONVERSION`
/// row in the history). So the page's centre of gravity is the convert strip: it says what the
/// points are worth before anything is pressed, confirms before it spends, and never retries.
///
/// Four requests, four independent outcomes. The balance failing replaces the page with a
/// failure; the rules or the coin history failing says so in their own card and leaves the
/// balance alone — they are not the answer to "how many points do I have".
struct PointsView: View {
    @Environment(Session.self) private var session

    @State private var rewards: MyRewards?
    @State private var meFailed = false
    @State private var rules: [RewardRule]?
    @State private var rulesFailed = false
    @State private var wallet: RewardsWallet?
    @State private var walletFailed = false

    /// The amount box is a string while it is being typed: an empty box must not read as 0,
    /// and a half-typed "3" must not become 3 when the student meant 30.
    @State private var amountText = ""
    @State private var isConverting = false
    @State private var outcome: ConvertOutcome?
    @State private var pending: PendingConversion?
    @FocusState private var amountFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero

                if meFailed {
                    RewardsErrorState(
                        title: "Points aren't loading right now.",
                        message: "Nothing has been lost — the page just couldn't fetch your total."
                    ) { await load() }
                    .cardStyle(padding: 8)
                }

                if rewards != nil || !meFailed {
                    earnings
                    howToEarn
                    coinHistory
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { amountFocused = false }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .alert(
            pending.map { Text(verbatim: "Convert \($0.spent) points into \(RewardsFormat.count($0.coins, "coin"))?") } ?? Text(verbatim: ""),
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            presenting: pending
        ) { conversion in
            Button("Convert") { Task { await convert(conversion) } }
            Button("Cancel", role: .cancel) {}
        } message: { conversion in
            Text(verbatim: conversion.message)
        }
    }

    // MARK: - Hero

    private var hero: some View {
        RewardsHero(
            eyebrow: "Rewards",
            eyebrowIcon: "sparkles",
            title: "Points",
            blurb: "What you've earned for showing up and doing the work."
        ) {
            if let rewards {
                VStack(alignment: .leading, spacing: 12) {
                    walletTiles(rewards)
                    convertStrip(rewards)
                    if let outcome { outcomeLine(outcome) }
                }
                .padding(.top, 22)
            } else if !meFailed {
                walletPlaceholder.padding(.top, 22)
            }
        }
    }

    /// XP sits beside points rather than replacing them: they answer different questions, and
    /// a student will notice the two disagree. The line under it says why before they ask.
    private func walletTiles(_ r: MyRewards) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                RewardsWalletTile(label: "Points", value: ScoreText.string(r.points)) {
                    RewardsCoinArt(kind: .point, size: 36)
                }
                .frame(maxHeight: .infinity)
                RewardsWalletTile(label: "Coins", value: ScoreText.string(r.coins), sub: "\(r.pointsPerCoin) points = 1 coin") {
                    RewardsCoinArt(kind: .coin, size: 36)
                }
                .frame(maxHeight: .infinity)
            }
            .fixedSize(horizontal: false, vertical: true)

            RewardsWalletTile(
                label: "XP",
                value: ScoreText.string(r.xp),
                sub: "Most of what you earn adds XP too — each rule below says. A lower score never takes it away, only a corrected record does."
            ) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.white.opacity(0.2)))
            }
        }
    }

    private var walletPlaceholder: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                RewardsWalletTile(label: "Points", value: "—") { RewardsCoinArt(kind: .point, size: 36) }
                RewardsWalletTile(label: "Coins", value: "—") { RewardsCoinArt(kind: .coin, size: 36) }
            }
            RewardsWalletTile(label: "XP", value: "—") {
                Circle().fill(.white.opacity(0.2)).frame(width: 36, height: 36)
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading your points")
    }

    // MARK: - Convert

    /// The only thing between a student and their coins now that points no longer convert on
    /// their own. With nothing to convert it keeps its place and reports the distance instead
    /// of vanishing, so a student learns where the button lives before they need it.
    private func convertStrip(_ r: MyRewards) -> some View {
        let preview = ConversionPreview(input: amountText, points: r.points, pointsPerCoin: r.pointsPerCoin)
        let headline = ConversionPreview.headline(convertibleCoins: r.convertibleCoins, pointsToNextCoin: r.pointsToNextCoin)
        let boxLocked = r.convertibleCoins == 0 || isConverting

        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(headline.overline.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.7)
                Text(headline.sentence)
                    .font(.system(size: 14, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(.white)
            .accessibilityElement(children: .combine)

            HStack(spacing: 8) {
                TextField("", text: $amountText, prompt: Text(verbatim: "Points").foregroundStyle(Color.black.opacity(0.4)))
                    .keyboardType(.numberPad)
                    .focused($amountFocused)
                    .font(.system(size: 16, weight: .bold).monospacedDigit())
                    .foregroundStyle(Color.black)
                    .tint(Theme.accent)
                    .padding(.horizontal, 12)
                    .frame(minWidth: 70, maxWidth: .infinity)
                    .frame(height: 42)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                            .fill(Color.white.opacity(boxLocked ? 0.6 : 0.95))
                    )
                    .disabled(boxLocked)
                    .accessibilityLabel("Points to convert")
                    .onChange(of: amountText) { _, typed in
                        // Whole numbers only. The number pad cannot type anything else, but a
                        // paste can.
                        let digits = String(typed.filter { $0.isASCII && $0.isNumber }.prefix(7))
                        if digits != typed { amountText = digits }
                    }

                // Fills the box rather than converting on the spot. Max is a shortcut for
                // typing a number, not a second way to spend.
                Button("Max") { amountText = String(r.maxConvertiblePoints) }
                    .buttonStyle(RewardsHeroButtonStyle(prominent: false))
                    .disabled(r.maxConvertiblePoints == 0 || isConverting)

                Button {
                    ask(preview)
                } label: {
                    HStack(spacing: 6) {
                        if isConverting {
                            ProgressView().controlSize(.small).tint(Theme.accent)
                        } else {
                            Image(systemName: "arrow.left.arrow.right").font(.system(size: 13, weight: .bold))
                        }
                        Text(isConverting ? "Converting…" : "Convert")
                    }
                }
                .buttonStyle(RewardsHeroButtonStyle(prominent: true))
                .disabled(!preview.canConvert || isConverting)
            }

            // What the press will do, BEFORE it happens — including the change that stays
            // behind, which is otherwise read as points going missing.
            if let message = preview.message {
                Text(message)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.92))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black.opacity(0.22)))
    }

    private func outcomeLine(_ outcome: ConvertOutcome) -> some View {
        let (icon, text): (String, String) = switch outcome {
        case .done(let detail): ("checkmark.circle.fill", detail)
        case .failed: ("exclamationmark.circle.fill", "That didn't go through — your points are untouched. Try again.")
        }
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold))
            Text(text)
                .font(.system(size: 14, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Your earnings

    private var earnings: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeading(
                icon: "list.bullet.rectangle",
                title: "Your earnings",
                subtitle: "Every point you've picked up so far"
            )
            if let history = rewards?.history {
                if history.isEmpty {
                    VStack(spacing: 12) {
                        RewardsCoinArt(kind: .point, size: 56)
                        DashedEmpty(
                            title: "Nothing yet — but everything counts",
                            hint: "Attend a lesson, finish your homework or sit a midterm, and your points will show up here."
                        )
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(history.enumerated()), id: \.element.id) { index, award in
                            if index > 0 { Divider().padding(.leading, 52) }
                            RewardsAwardRow(award: award)
                        }
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 16)
            }
        }
        .cardStyle(padding: 18)
    }

    // MARK: - How to earn

    private var howToEarn: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeading(
                icon: "sparkles",
                title: "How to earn",
                subtitle: "Served from the learning center's live rules"
            )
            if rulesFailed && rules == nil {
                RewardsErrorState(
                    title: "The rules aren't loading right now.",
                    message: "Your points are unaffected — only this list failed to load."
                ) { await loadRules() }
            } else if let rules {
                let earnable = RewardRule.earnable(rules)
                if earnable.isEmpty {
                    // A blank card reads as "there is nothing to earn", the opposite of true.
                    DashedEmpty(
                        title: "No earning rules yet",
                        hint: "Your learning center is still tuning how points are awarded — they'll show up here."
                    )
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(earnable) { RewardsRuleRow(rule: $0) }
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12)
            }
        }
        .cardStyle(padding: 18)
    }

    // MARK: - Coin history

    @ViewBuilder private var coinHistory: some View {
        if walletFailed && wallet == nil {
            VStack(alignment: .leading, spacing: 12) {
                CardHeading(icon: "arrow.left.arrow.right", title: "Coin history", subtitle: "Coins you've earned and spent")
                RewardsErrorState(
                    title: "Your coin history isn't loading right now.",
                    message: "Your coins are safe — only this list failed to load."
                ) { await loadWallet() }
            }
            .cardStyle(padding: 18)
        } else if let transactions = wallet?.transactions, !transactions.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                CardHeading(icon: "arrow.left.arrow.right", title: "Coin history", subtitle: "Coins you've earned and spent")
                VStack(spacing: 0) {
                    ForEach(Array(transactions.enumerated()), id: \.element.id) { index, transaction in
                        if index > 0 { Divider() }
                        RewardsCoinRow(transaction: transaction)
                    }
                }
            }
            .cardStyle(padding: 18)
        }
    }

    // MARK: - Loading

    @MainActor
    private func load() async {
        async let me: Void = loadMe()
        async let theRules: Void = loadRules()
        async let theWallet: Void = loadWallet()
        _ = await (me, theRules, theWallet)
    }

    @MainActor
    private func loadMe() async {
        let api = session.rewards
        do {
            rewards = try await api.me()
            meFailed = false
        } catch {
            meFailed = true
        }
    }

    @MainActor
    private func loadRules() async {
        let api = session.rewards
        do {
            rules = try await api.rules()
            rulesFailed = false
        } catch {
            rulesFailed = true
        }
    }

    @MainActor
    private func loadWallet() async {
        let api = session.rewards
        do {
            wallet = try await api.wallet()
            walletFailed = false
        } catch {
            walletFailed = true
        }
    }

    // MARK: - Converting

    private func ask(_ preview: ConversionPreview) {
        guard case .buys(let coins, let spent, let kept) = preview.state, let asked = preview.asked else { return }
        amountFocused = false
        pending = PendingConversion(asked: asked, coins: coins, spent: spent, kept: kept)
    }

    /// Spends the points. Not idempotent — a second press is a second purchase — so it runs
    /// once per confirmation, with the button off while it is in flight, and is never retried.
    @MainActor
    private func convert(_ conversion: PendingConversion) async {
        guard !isConverting else { return }
        isConverting = true
        outcome = nil
        let api = session.rewards
        do {
            let result = try await api.convert(points: conversion.asked)
            rewards = rewards?.applying(result.balances)
            // Cleared on success only: a spent amount left in the box invites a second press
            // that would spend it again, and clearing it on failure throws away what was typed.
            amountText = ""
            outcome = .done(
                result.detail.isEmpty
                    ? "Converted \(conversion.spent) points into \(RewardsFormat.count(conversion.coins, "coin"))."
                    : result.detail
            )
        } catch {
            outcome = .failed
        }
        isConverting = false
        // Either way, read the truth back: the history gains its conversion row and the coin
        // history its mint — and a press that did land despite an error shows up as it is.
        async let me: Void = loadMe()
        async let theWallet: Void = loadWallet()
        _ = await (me, theWallet)
    }
}

// MARK: - Pieces

private enum ConvertOutcome: Equatable {
    case done(String)
    case failed
}

private struct PendingConversion: Identifiable {
    let id = UUID()
    let asked: Int
    let coins: Int
    let spent: Int
    let kept: Int

    var message: String {
        let tail = "Converted points don't come back, and your XP stays where it is."
        return kept > 0 ? "You keep the other \(RewardsFormat.count(kept, "point")). \(tail)" : tail
    }
}

/// A figure inside the blue: the coin art, a label, the number, and the line that explains it.
struct RewardsWalletTile<Media: View>: View {
    let label: String
    let value: String
    var sub: String?
    @ViewBuilder var media: () -> Media

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            media()
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.7)
                Text(value)
                    .font(.system(size: 26, weight: .heavy))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                // Wraps rather than truncates: the XP rule takes a sentence to state honestly.
                if let sub {
                    Text(sub)
                        .font(.system(size: 11, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        // A dark scrim, not a light one: white text on a white wash over the gradient fails
        // contrast, which is why the web moved to this.
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black.opacity(0.22)))
        .accessibilityElement(children: .combine)
    }
}

/// A button that sits on the hero's blue: solid white for the action, a white wash for the rest.
struct RewardsHeroButtonStyle: ButtonStyle {
    var prominent: Bool

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, prominent: prominent)
    }

    /// A view of its own so it can read `isEnabled`, which a style's `makeBody` cannot.
    private struct Styled: View {
        let configuration: ButtonStyleConfiguration
        let prominent: Bool
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(prominent ? Theme.accent : Color.white)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 12)
                .frame(height: 42)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(prominent ? Color.white : Color.white.opacity(0.18))
                )
                .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
        }
    }
}

/// One line of the points history.
private struct RewardsAwardRow: View {
    let award: PointAward

    private var subtitle: String {
        [award.classroomName, award.note.isEmpty ? nil : award.note, RewardsDate.short(award.awardedAt)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: RewardsEventIcon.symbol(for: award.event), size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(award.label)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 12)
            // A conversion is the one row that SPENDS, so it is the one that must not wear a
            // green plus: signed, and neutral-coloured.
            Text(award.signedPoints)
                .font(.system(size: 14, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(award.isSpend ? Theme.textSecondary : Theme.success)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

/// One rule under "How to earn": what it is, what it pays, and what to do about it.
private struct RewardsRuleRow: View {
    let rule: RewardRule

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 12) {
                Text(rule.label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if let amount = rule.amountText {
                    Text(amount)
                        .font(.system(size: 14, weight: .heavy))
                        .monospacedDigit()
                } else {
                    Text("Set by your teacher")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            if let hint = rule.hint {
                Text(hint)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// One coin movement: what it was for, when, and which way it went.
private struct RewardsCoinRow: View {
    let transaction: CoinTransaction

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.title)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                Text(RewardsDate.short(transaction.createdAt))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 12)
            Text(transaction.signedAmount)
                .font(.system(size: 14, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(transaction.isSpend ? Theme.textSecondary : Theme.success)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

/// One glyph per family of earning, so the history reads at a glance — the web's lucide set,
/// in SF Symbols. The retired homework bands keep theirs: nothing new is awarded under them,
/// but every row banked under them still comes back.
enum RewardsEventIcon {
    static func symbol(for event: String) -> String {
        switch event {
        case "ATTENDANCE_PRESENT", "ATTENDANCE_LATE": return "calendar.badge.checkmark"
        case "SUPPORT_SESSION": return "lifepreserver"
        case "SURVEY": return "bubble.left"
        case "MIDTERM_PASS", "MIDTERM_RETAKE_PASS": return "doc.text"
        case "HOMEWORK", "HOMEWORK_FULL", "HOMEWORK_HIGH", "HOMEWORK_MID": return "list.clipboard"
        case "CLASSWORK_MANUAL": return "graduationcap"
        case "EVENT_ATTENDED": return "calendar"
        case "COIN_CONVERSION": return "arrow.left.arrow.right"
        default: return "sparkles"
        }
    }
}
