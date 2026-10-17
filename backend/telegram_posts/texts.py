"""Every fixed line the bot puts in a group post, in Uzbek (Latin). Dynamic values are escaped
by the caller (`render`), never here."""

WEEKDAYS = ("Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba")
MONTHS = (
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
)

ANNOUNCE_HEAD = "📢 <b>{title}</b>"
REMINDER_HEAD = "⏰ <b>Ertaga: {title}</b>"
WHEN_LINE = "🗓 {when}"
PLACE_LINE = "📍 {place}"
SEATS_LINE = "👥 {seats} ta joy"
SEATS_LEFT = "✅ {n} ta joy qoldi"
SEATS_FULL = "🎟 Joylar to'ldi — ro'yxatdan o'tganlar, sizni kutamiz!"
SIGN_UP_BUTTON = "📝 Ro'yxatdan o'tish"
#: Ends a description cut to Telegram's limit. HTML, so `render` counts it as it will show.
MORE_ON_SITE = "… <i>to'liq matn saytda</i>"
#: Ends an admin's own post cut to the limit. Bare: the site has no copy of an admin's post to point at.
MANUAL_CUT = "…"
