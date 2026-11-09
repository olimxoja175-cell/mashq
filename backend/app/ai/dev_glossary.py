"""DEVELOPMENT-MODE translation memory.

This is NOT machine translation. It is a small, human-written phrase table used only
when no real translation provider is configured, so the full pipeline (routing,
subtitles, uncertainty warnings, speech playback) can be demonstrated offline.
Any sentence that is not in this table is returned untranslated and flagged as
uncertain — the system never pretends to have translated it."""
from __future__ import annotations

import difflib
import re
import unicodedata

PHRASES: list[dict[str, str]] = [
    {
        "en": "Good afternoon, Mr. President.",
        "uz": "Xayrli kun, janob Prezident.",
        "zh": "下午好，总统先生。",
        "ru": "Добрый день, господин Президент.",
        "ar": "مساء الخير، سيادة الرئيس.",
        "fr": "Bonjour, Monsieur le Président.",
        "de": "Guten Tag, Herr Präsident.",
        "es": "Buenas tardes, señor Presidente.",
        "tr": "İyi günler, Sayın Cumhurbaşkanı.",
        "fa": "عصر بخیر، جناب رئیس‌جمهور.",
        "hi": "नमस्कार, राष्ट्रपति महोदय।",
        "ja": "大統領閣下、こんにちは。",
        "ko": "안녕하십니까, 대통령님.",
        "pt": "Boa tarde, Senhor Presidente.",
    },
    {
        "en": "Thank you for your warm welcome.",
        "uz": "Iliq kutib olganingiz uchun rahmat.",
        "zh": "感谢您的热情欢迎。",
        "ru": "Благодарю вас за тёплый приём.",
        "ar": "شكرًا لكم على حفاوة الاستقبال.",
        "fr": "Merci pour votre accueil chaleureux.",
        "de": "Vielen Dank für Ihren herzlichen Empfang.",
        "es": "Gracias por su cálida bienvenida.",
        "tr": "Sıcak karşılamanız için teşekkür ederim.",
        "fa": "از استقبال گرم شما سپاسگزارم.",
        "hi": "आपके गर्मजोशी भरे स्वागत के लिए धन्यवाद।",
        "ja": "温かい歓迎に感謝いたします。",
        "ko": "따뜻하게 환영해 주셔서 감사합니다.",
        "pt": "Obrigado pela calorosa receção.",
    },
    {
        "en": "We are ready to strengthen cooperation between our countries.",
        "uz": "Biz mamlakatlarimiz oʻrtasidagi hamkorlikni mustahkamlashga tayyormiz.",
        "zh": "我们愿意加强我们两国之间的合作。",
        "ru": "Мы готовы укреплять сотрудничество между нашими странами.",
        "ar": "نحن مستعدون لتعزيز التعاون بين بلدينا.",
        "fr": "Nous sommes prêts à renforcer la coopération entre nos pays.",
        "de": "Wir sind bereit, die Zusammenarbeit zwischen unseren Ländern zu stärken.",
        "es": "Estamos dispuestos a fortalecer la cooperación entre nuestros países.",
        "tr": "Ülkelerimiz arasındaki iş birliğini güçlendirmeye hazırız.",
        "fa": "ما آماده‌ایم همکاری میان کشورهایمان را تقویت کنیم.",
        "hi": "हम अपने देशों के बीच सहयोग को मज़बूत करने के लिए तैयार हैं।",
        "ja": "私たちは両国間の協力を強化する用意があります。",
        "ko": "우리는 양국 간의 협력을 강화할 준비가 되어 있습니다.",
        "pt": "Estamos prontos para reforçar a cooperação entre os nossos países.",
    },
    {
        "en": "Let us discuss trade and investment.",
        "uz": "Keling, savdo va investitsiyalarni muhokama qilaylik.",
        "zh": "让我们讨论贸易和投资。",
        "ru": "Давайте обсудим торговлю и инвестиции.",
        "ar": "دعونا نناقش التجارة والاستثمار.",
        "fr": "Discutons du commerce et des investissements.",
        "de": "Lassen Sie uns über Handel und Investitionen sprechen.",
        "es": "Hablemos de comercio e inversiones.",
        "tr": "Ticaret ve yatırımları görüşelim.",
        "fa": "بیایید درباره تجارت و سرمایه‌گذاری گفتگو کنیم.",
        "hi": "आइए व्यापार और निवेश पर चर्चा करें।",
        "ja": "貿易と投資について話し合いましょう。",
        "ko": "무역과 투자에 대해 논의합시다.",
        "pt": "Vamos discutir comércio e investimento.",
    },
    {
        "en": "I propose that we sign the agreement on 15 March 2027.",
        "uz": "Kelishuvni 2027-yil 15-martda imzolashni taklif qilaman.",
        "zh": "我提议我们于2027年3月15日签署该协议。",
        "ru": "Я предлагаю подписать соглашение 15 марта 2027 года.",
        "ar": "أقترح أن نوقّع الاتفاقية في 15 مارس 2027.",
        "fr": "Je propose que nous signions l'accord le 15 mars 2027.",
        "de": "Ich schlage vor, dass wir das Abkommen am 15. März 2027 unterzeichnen.",
        "es": "Propongo que firmemos el acuerdo el 15 de marzo de 2027.",
        "tr": "Anlaşmayı 15 Mart 2027'de imzalamamızı öneriyorum.",
        "fa": "پیشنهاد می‌کنم توافقنامه را در ۱۵ مارس ۲۰۲۷ امضا کنیم.",
        "hi": "मेरा प्रस्ताव है कि हम 15 मार्च 2027 को समझौते पर हस्ताक्षर करें।",
        "ja": "2027年3月15日に協定に署名することを提案します。",
        "ko": "2027년 3월 15일에 협정에 서명할 것을 제안합니다.",
        "pt": "Proponho que assinemos o acordo em 15 de março de 2027.",
    },
    {
        "en": "Our delegations will meet again next month.",
        "uz": "Delegatsiyalarimiz kelasi oy yana uchrashadi.",
        "zh": "我们的代表团将于下个月再次会面。",
        "ru": "Наши делегации снова встретятся в следующем месяце.",
        "ar": "ستلتقي وفودنا مجددًا الشهر المقبل.",
        "fr": "Nos délégations se réuniront à nouveau le mois prochain.",
        "de": "Unsere Delegationen werden sich nächsten Monat erneut treffen.",
        "es": "Nuestras delegaciones volverán a reunirse el próximo mes.",
        "tr": "Heyetlerimiz önümüzdeki ay tekrar bir araya gelecek.",
        "fa": "هیئت‌های ما ماه آینده دوباره دیدار خواهند کرد.",
        "hi": "हमारे प्रतिनिधिमंडल अगले महीने फिर मिलेंगे।",
        "ja": "私たちの代表団は来月再び会合します。",
        "ko": "우리 대표단은 다음 달에 다시 만날 것입니다.",
        "pt": "As nossas delegações voltarão a reunir-se no próximo mês.",
    },
    {
        "en": "Can you hear me well?",
        "uz": "Meni yaxshi eshityapsizmi?",
        "zh": "您能听清楚我说话吗？",
        "ru": "Вы меня хорошо слышите?",
        "ar": "هل تسمعني جيدًا؟",
        "fr": "M'entendez-vous bien ?",
        "de": "Können Sie mich gut hören?",
        "es": "¿Me oye bien?",
        "tr": "Beni iyi duyabiliyor musunuz?",
        "fa": "صدای من را خوب می‌شنوید؟",
        "hi": "क्या आप मुझे ठीक से सुन पा रहे हैं?",
        "ja": "私の声はよく聞こえますか？",
        "ko": "제 말이 잘 들리십니까?",
        "pt": "Consegue ouvir-me bem?",
    },
    {
        "en": "Thank you. Goodbye.",
        "uz": "Rahmat. Xayr.",
        "zh": "谢谢。再见。",
        "ru": "Спасибо. До свидания.",
        "ar": "شكرًا لكم. وداعًا.",
        "fr": "Merci. Au revoir.",
        "de": "Vielen Dank. Auf Wiedersehen.",
        "es": "Gracias. Adiós.",
        "tr": "Teşekkürler. Hoşça kalın.",
        "fa": "سپاسگزارم. خدانگهدار.",
        "hi": "धन्यवाद। अलविदा।",
        "ja": "ありがとうございました。さようなら。",
        "ko": "감사합니다. 안녕히 계십시오.",
        "pt": "Obrigado. Adeus.",
    },
]

_APOS = dict.fromkeys(map(ord, "ʻʼ‘’`´'"), None)


def normalize_text(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).translate(_APOS).replace("‌", "").casefold()
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


_INDEX: dict[str, dict[str, int]] = {}
for _i, _p in enumerate(PHRASES):
    for _lang, _txt in _p.items():
        _INDEX.setdefault(_lang, {})[normalize_text(_txt)] = _i


def lookup(text: str, source: str, target: str) -> tuple[str, float] | None:
    """Returns (translation, match_score) or None when the phrase is unknown."""
    table = _INDEX.get(source, {})
    key = normalize_text(text)
    if key in table:
        return PHRASES[table[key]][target], 1.0
    best = difflib.get_close_matches(key, list(table), n=1, cutoff=0.86)
    if best:
        score = difflib.SequenceMatcher(None, key, best[0]).ratio()
        return PHRASES[table[best[0]]][target], round(score, 3)
    return None


def demo_phrases(lang: str) -> list[str]:
    return [p[lang] for p in PHRASES if lang in p]
