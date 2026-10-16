"""What the class bot says, in Uzbek (plan 2026-10-16).

One place for every line the bot sends, so the conversation reads as one voice and a wording
change is one edit. The site itself stays in English (the owner's 2026-10-14 rule for the
student side); only the bot speaks Uzbek. Anything dynamic is passed through ``esc`` by the
caller — every message goes out as HTML, and Telegram drops a whole message whose markup does
not parse. Inline BUTTON labels are plain text and are not escaped.
"""

from __future__ import annotations

from .telegram_group_api import esc

# ── Signing in ───────────────────────────────────────────────────────────────
ASK_LOGIN = (
    "👋 Assalomu alaykum! Bu MasterSAT guruhlar boti.\n\n"
    "MasterSAT <b>loginingizni</b> yozing: telefon raqam, username yoki email."
)
ASK_PASSWORD = "Endi <b>parolingizni</b> yozing. Xabaringizni darhol o'chirib yuboraman."
WRONG = "❌ Login yoki parol noto'g'ri ({n}/{max}).\n\nLoginingizni qaytadan yozing."
LOCKED = "⛔ Juda ko'p noto'g'ri urinish. {minutes} daqiqadan keyin qayta urinib ko'ring."
NO_PASSWORD_YET = (
    "Bu akkauntga hali parol o'rnatilmagan. Avval mastersat.uz saytiga kirib parol o'rnating, "
    "keyin shu yerga qayting va /start bosing."
)
NOT_A_STUDENT = "Bu bot faqat MasterSAT o'quvchilari uchun."
TG_TAKEN = "Bu Telegram boshqa MasterSAT akkauntiga ulangan. Avval /chiqish buyrug'ini yuboring."
DELETE_FAILED = "⚠️ Parolli xabaringizni o'chira olmadim. Iltimos, uni o'zingiz o'chiring."
WELCOME = "✅ Xush kelibsiz, {name}! Telegramingiz MasterSAT akkauntingizga ulandi."
NOT_BOUND = "Avval MasterSAT akkauntingiz bilan kiring: /start"
LOGGED_OUT = "Telegramingiz MasterSAT akkauntidan uzildi. Qayta kirish uchun: /start"

# ── The groups menu ──────────────────────────────────────────────────────────
MENU_TITLE = "📚 <b>Guruhlaringiz</b>\n\nGuruhga kirish uchun tugmani bosing."
MENU_EMPTY = "Sizning classlaringizda hozircha Telegram guruh yo'q."
NOT_YOUR_GROUP = "Bu guruh sizning classlaringiz orasida yo'q. Ro'yxat: /guruhlar"
ALREADY_IN = "✅ Siz <b>{group}</b> guruhidasiz."
INVITE = (
    "🔗 <b>{group}</b> guruhiga bir martalik link:\n{link}\n\n"
    "Faqat siz uchun, bir marta ishlaydi va {minutes} daqiqada eskiradi."
)
INVITE_FAILED = "Hozir link chiqarib bo'lmadi. Birozdan keyin qayta urinib ko'ring."
LOCKED_GROUP_DEBT = (
    "🔒 <b>{group}</b>: oylik to'lov qilinmagani uchun guruh yopiq.\n\n"
    "To'lov qilinganidan keyin shu bot orqali qayta qo'shilishingiz mumkin."
)
LOCKED_GROUP_ADMIN = "🔒 <b>{group}</b>: akkauntingiz muzlatilgan. Administratorga murojaat qiling."

# ── Coming out of a group, and back ──────────────────────────────────────────
REMOVED_DEBT = (
    "❗ Oylik to'lov qilinmaganligi sababli siz quyidagi guruhlardan chiqarildingiz:\n{groups}\n\n"
    "To'lov qilinganidan keyin shu bot orqali qayta qo'shilishingiz mumkin."
)
REMOVED_FROZEN = (
    "Akkauntingiz muzlatildi, shuning uchun quyidagi guruhlardan chiqarildingiz:\n{groups}\n\n"
    "Administratorga murojaat qiling."
)
REMOVED_NOT_IN_CLASS = "Classdan chiqqaningiz uchun uning Telegram guruhidan ham chiqarildingiz:\n{groups}"
REMOVED_MISMATCH = (
    "Bir martalik linkingizni boshqa odam ochdi, u guruhdan chiqarildi. "
    "Yangi link uchun: /guruhlar. Linkni hech kimga bermang."
)
REMOVED_MANUAL = "Administrator sizni quyidagi guruhdan chiqardi:\n{groups}"
UNFROZEN = "🔓 Akkauntingiz faollashdi! Guruhlaringizga qaytishingiz mumkin:"

# ── Payments ─────────────────────────────────────────────────────────────────
PAYMENT = "✅ <b>{group}</b> uchun {amount} so'm to'lov qabul qilindi."
PAYMENT_NO_GROUP = "✅ {amount} so'm to'lov qabul qilindi."
PAYMENT_NO_DEBT = "Qarzingiz qolmadi."
PAYMENT_DEBT_LEFT = "Qolgan qarz: {debt} so'm."

# ── The one-off note posted into every class group ───────────────────────────
ANNOUNCE = (
    "📢 <b>Guruh a'zolari!</b>\n\n"
    "MasterSAT botiga kiring va MasterSAT login/parolingiz bilan ro'yxatdan o'ting. "
    "Guruhlaringiz, to'lov xabarlari va yangi linklar shu botda bo'ladi."
)
ANNOUNCE_BUTTON = "🤖 Botga kirish"


def som(amount) -> str:
    """500000 → "500 000": so'm the way a receipt writes it."""
    return f"{int(amount):,}".replace(",", " ")


def group_list(names) -> str:
    """One bullet per class, escaped for the HTML message it lands in."""
    return "\n".join(f"• {esc(name)}" for name in names)
