"use client";

/** Interface strings. Fully translated: en, uz, ru, ar, fa, zh. Other UI languages fall back
 *  to English (spoken translation still covers all 14 languages). Add a language by adding a
 *  dictionary below; RTL is driven by the language registry. */

const en = {
  dashboard: "Dashboard", profile: "Official profile", newMeeting: "New meeting", invitations: "Invitations",
  scheduled: "Scheduled meetings", history: "Meeting history", contacts: "Authorized contacts",
  languageSettings: "Language", audioSettings: "Audio & voice", securitySettings: "Security",
  administration: "Administration", monitoring: "System monitoring", access: "Access management",
  signOut: "Sign out", startMeeting: "Start new meeting", join: "Join", joinMeeting: "Join meeting",
  accept: "Accept", decline: "Decline", save: "Save changes", saved: "Saved", cancel: "Cancel",
  mic: "Microphone", camera: "Camera", fullscreen: "Full screen", leave: "Leave", endMeeting: "End meeting",
  subtitles: "Subtitles", transcript: "Transcript", participants: "Participants", speaks: "Speaks",
  youHear: "You hear", original: "Original", translated: "Translated", aiActive: "AI translation active",
  aiVoice: "AI voice", recording: "Record active", connected: "Connected", reconnecting: "Reconnecting…",
  connecting: "Connecting…", uncertain: "Uncertain translation — verify the original", welcome: "Welcome",
  securityStatus: "Security status", recentMeetings: "Recent meetings", incoming: "Incoming invitations",
  upcoming: "Upcoming", noItems: "Nothing here yet", spokenLanguage: "I speak", listenLanguage: "I listen in",
  e2e: "Media end-to-end encrypted", devMode: "Development mode", typeStatement: "Type a statement",
  send: "Send", waitingOthers: "Waiting for other participants…", quality: "Network",
  lipSync: "Lip-sync delay", originalVolume: "Original voice volume", you: "You", host: "Host",
  verified: "Identity verified", notVerified: "Not verified", identityVerification: "Identity verification",
  signIn: "Sign in", email: "Official email", password: "Password", verify: "Verify", code: "Authenticator code",
  raiseHand: "Raise hand", settings: "Settings",
};
type Dict = typeof en;

const uz: Dict = {
  dashboard: "Boshqaruv paneli", profile: "Rasmiy profil", newMeeting: "Yangi uchrashuv", invitations: "Taklifnomalar",
  scheduled: "Rejalashtirilgan uchrashuvlar", history: "Uchrashuvlar tarixi", contacts: "Vakolatli kontaktlar",
  languageSettings: "Til", audioSettings: "Ovoz va audio", securitySettings: "Xavfsizlik",
  administration: "Ma'muriyat", monitoring: "Tizim monitoringi", access: "Kirish huquqlari",
  signOut: "Chiqish", startMeeting: "Yangi uchrashuv boshlash", join: "Qo'shilish", joinMeeting: "Uchrashuvga qo'shilish",
  accept: "Qabul qilish", decline: "Rad etish", save: "Saqlash", saved: "Saqlandi", cancel: "Bekor qilish",
  mic: "Mikrofon", camera: "Kamera", fullscreen: "To'liq ekran", leave: "Chiqish", endMeeting: "Uchrashuvni yakunlash",
  subtitles: "Subtitrlar", transcript: "Stenogramma", participants: "Ishtirokchilar", speaks: "So'zlaydi",
  youHear: "Siz eshitasiz", original: "Asl matn", translated: "Tarjima", aiActive: "AI tarjima faol",
  aiVoice: "AI ovoz", recording: "Qayd yoqilgan", connected: "Ulangan", reconnecting: "Qayta ulanmoqda…",
  connecting: "Ulanmoqda…", uncertain: "Tarjima noaniq — asl matnni tekshiring", welcome: "Xush kelibsiz",
  securityStatus: "Xavfsizlik holati", recentMeetings: "So'nggi uchrashuvlar", incoming: "Kiruvchi taklifnomalar",
  upcoming: "Kelgusi", noItems: "Hozircha hech narsa yo'q", spokenLanguage: "Men gapiraman", listenLanguage: "Men eshitaman",
  e2e: "Media uchdan-uchga shifrlangan", devMode: "Ishlab chiqish rejimi", typeStatement: "Bayonot yozing",
  send: "Yuborish", waitingOthers: "Boshqa ishtirokchilar kutilmoqda…", quality: "Tarmoq",
  lipSync: "Lab sinxroni kechikishi", originalVolume: "Asl ovoz balandligi", you: "Siz", host: "Mezbon",
  verified: "Shaxs tasdiqlangan", notVerified: "Tasdiqlanmagan", identityVerification: "Shaxsni tasdiqlash",
  signIn: "Kirish", email: "Rasmiy email", password: "Parol", verify: "Tasdiqlash", code: "Autentifikator kodi",
  raiseHand: "Qo'l ko'tarish", settings: "Sozlamalar",
};

const ru: Dict = {
  dashboard: "Панель управления", profile: "Официальный профиль", newMeeting: "Новая встреча", invitations: "Приглашения",
  scheduled: "Запланированные встречи", history: "История встреч", contacts: "Доверенные контакты",
  languageSettings: "Язык", audioSettings: "Аудио и голос", securitySettings: "Безопасность",
  administration: "Администрирование", monitoring: "Мониторинг системы", access: "Управление доступом",
  signOut: "Выйти", startMeeting: "Начать встречу", join: "Войти", joinMeeting: "Присоединиться",
  accept: "Принять", decline: "Отклонить", save: "Сохранить", saved: "Сохранено", cancel: "Отмена",
  mic: "Микрофон", camera: "Камера", fullscreen: "Во весь экран", leave: "Выйти", endMeeting: "Завершить встречу",
  subtitles: "Субтитры", transcript: "Стенограмма", participants: "Участники", speaks: "Говорит",
  youHear: "Вы слышите", original: "Оригинал", translated: "Перевод", aiActive: "ИИ-перевод активен",
  aiVoice: "ИИ-голос", recording: "Запись протокола", connected: "Подключено", reconnecting: "Переподключение…",
  connecting: "Подключение…", uncertain: "Неуверенный перевод — сверьте с оригиналом", welcome: "Добро пожаловать",
  securityStatus: "Статус безопасности", recentMeetings: "Недавние встречи", incoming: "Входящие приглашения",
  upcoming: "Предстоящие", noItems: "Пока ничего нет", spokenLanguage: "Я говорю", listenLanguage: "Я слушаю на",
  e2e: "Медиа со сквозным шифрованием", devMode: "Режим разработки", typeStatement: "Напишите заявление",
  send: "Отправить", waitingOthers: "Ожидание участников…", quality: "Сеть",
  lipSync: "Задержка синхронизации губ", originalVolume: "Громкость оригинала", you: "Вы", host: "Организатор",
  verified: "Личность подтверждена", notVerified: "Не подтверждено", identityVerification: "Подтверждение личности",
  signIn: "Войти", email: "Служебный email", password: "Пароль", verify: "Подтвердить", code: "Код аутентификатора",
  raiseHand: "Поднять руку", settings: "Настройки",
};

const ar: Dict = {
  dashboard: "لوحة التحكم", profile: "الملف الرسمي", newMeeting: "اجتماع جديد", invitations: "الدعوات",
  scheduled: "الاجتماعات المجدولة", history: "سجل الاجتماعات", contacts: "جهات الاتصال المعتمدة",
  languageSettings: "اللغة", audioSettings: "الصوت", securitySettings: "الأمان",
  administration: "الإدارة", monitoring: "مراقبة النظام", access: "إدارة الصلاحيات",
  signOut: "تسجيل الخروج", startMeeting: "بدء اجتماع جديد", join: "انضمام", joinMeeting: "الانضمام إلى الاجتماع",
  accept: "قبول", decline: "رفض", save: "حفظ التغييرات", saved: "تم الحفظ", cancel: "إلغاء",
  mic: "الميكروفون", camera: "الكاميرا", fullscreen: "ملء الشاشة", leave: "مغادرة", endMeeting: "إنهاء الاجتماع",
  subtitles: "الترجمة النصية", transcript: "المحضر", participants: "المشاركون", speaks: "يتحدث",
  youHear: "تسمع", original: "الأصل", translated: "الترجمة", aiActive: "الترجمة بالذكاء الاصطناعي مفعّلة",
  aiVoice: "صوت اصطناعي", recording: "التسجيل مفعّل", connected: "متصل", reconnecting: "جارٍ إعادة الاتصال…",
  connecting: "جارٍ الاتصال…", uncertain: "ترجمة غير مؤكدة — راجع النص الأصلي", welcome: "مرحبًا",
  securityStatus: "حالة الأمان", recentMeetings: "الاجتماعات الأخيرة", incoming: "الدعوات الواردة",
  upcoming: "القادمة", noItems: "لا يوجد شيء بعد", spokenLanguage: "أتحدث", listenLanguage: "أستمع بـ",
  e2e: "الوسائط مشفرة من طرف إلى طرف", devMode: "وضع التطوير", typeStatement: "اكتب بيانًا",
  send: "إرسال", waitingOthers: "بانتظار المشاركين الآخرين…", quality: "الشبكة",
  lipSync: "تأخير مزامنة الشفاه", originalVolume: "مستوى الصوت الأصلي", you: "أنت", host: "المضيف",
  verified: "تم التحقق من الهوية", notVerified: "غير موثّق", identityVerification: "التحقق من الهوية",
  signIn: "تسجيل الدخول", email: "البريد الرسمي", password: "كلمة المرور", verify: "تحقق", code: "رمز المصادقة",
  raiseHand: "رفع اليد", settings: "الإعدادات",
};

const fa: Dict = {
  dashboard: "داشبورد", profile: "نمایه رسمی", newMeeting: "جلسه جدید", invitations: "دعوت‌نامه‌ها",
  scheduled: "جلسات برنامه‌ریزی‌شده", history: "تاریخچه جلسات", contacts: "مخاطبان مجاز",
  languageSettings: "زبان", audioSettings: "صدا", securitySettings: "امنیت",
  administration: "مدیریت", monitoring: "پایش سامانه", access: "مدیریت دسترسی",
  signOut: "خروج", startMeeting: "شروع جلسه جدید", join: "پیوستن", joinMeeting: "پیوستن به جلسه",
  accept: "پذیرفتن", decline: "رد کردن", save: "ذخیره تغییرات", saved: "ذخیره شد", cancel: "انصراف",
  mic: "میکروفون", camera: "دوربین", fullscreen: "تمام‌صفحه", leave: "ترک جلسه", endMeeting: "پایان جلسه",
  subtitles: "زیرنویس", transcript: "صورت‌جلسه", participants: "شرکت‌کنندگان", speaks: "سخن می‌گوید",
  youHear: "شما می‌شنوید", original: "متن اصلی", translated: "ترجمه", aiActive: "ترجمه هوش مصنوعی فعال است",
  aiVoice: "صدای مصنوعی", recording: "ثبت فعال است", connected: "متصل", reconnecting: "در حال اتصال مجدد…",
  connecting: "در حال اتصال…", uncertain: "ترجمه نامطمئن — متن اصلی را بررسی کنید", welcome: "خوش آمدید",
  securityStatus: "وضعیت امنیت", recentMeetings: "جلسات اخیر", incoming: "دعوت‌های دریافتی",
  upcoming: "پیش رو", noItems: "هنوز موردی نیست", spokenLanguage: "زبان گفتار من", listenLanguage: "زبان شنیدن من",
  e2e: "رسانه رمزنگاری سرتاسری", devMode: "حالت توسعه", typeStatement: "بیانیه بنویسید",
  send: "ارسال", waitingOthers: "در انتظار سایر شرکت‌کنندگان…", quality: "شبکه",
  lipSync: "تأخیر همگام‌سازی لب", originalVolume: "بلندی صدای اصلی", you: "شما", host: "میزبان",
  verified: "هویت تأیید شده", notVerified: "تأیید نشده", identityVerification: "تأیید هویت",
  signIn: "ورود", email: "ایمیل رسمی", password: "گذرواژه", verify: "تأیید", code: "کد احراز هویت",
  raiseHand: "بالا بردن دست", settings: "تنظیمات",
};

const zh: Dict = {
  dashboard: "控制台", profile: "官方资料", newMeeting: "新建会议", invitations: "会议邀请",
  scheduled: "已安排的会议", history: "会议记录", contacts: "授权联系人",
  languageSettings: "语言", audioSettings: "音频与声音", securitySettings: "安全",
  administration: "系统管理", monitoring: "系统监控", access: "访问管理",
  signOut: "退出登录", startMeeting: "发起新会议", join: "加入", joinMeeting: "加入会议",
  accept: "接受", decline: "拒绝", save: "保存更改", saved: "已保存", cancel: "取消",
  mic: "麦克风", camera: "摄像头", fullscreen: "全屏", leave: "离开", endMeeting: "结束会议",
  subtitles: "字幕", transcript: "会议纪要", participants: "参会者", speaks: "讲",
  youHear: "您听到", original: "原文", translated: "译文", aiActive: "AI 同声传译已启用",
  aiVoice: "AI 语音", recording: "记录已开启", connected: "已连接", reconnecting: "正在重新连接…",
  connecting: "正在连接…", uncertain: "译文不确定 — 请核对原文", welcome: "欢迎",
  securityStatus: "安全状态", recentMeetings: "最近的会议", incoming: "收到的邀请",
  upcoming: "即将举行", noItems: "暂无内容", spokenLanguage: "我说", listenLanguage: "我收听",
  e2e: "媒体端到端加密", devMode: "开发模式", typeStatement: "输入发言",
  send: "发送", waitingOthers: "等待其他参会者…", quality: "网络",
  lipSync: "口型同步延迟", originalVolume: "原声音量", you: "您", host: "主持人",
  verified: "身份已验证", notVerified: "未验证", identityVerification: "身份验证",
  signIn: "登录", email: "官方邮箱", password: "密码", verify: "验证", code: "验证器代码",
  raiseHand: "举手", settings: "设置",
};

const DICTS: Record<string, Dict> = { en, uz, ru, ar, fa, zh };
export const RTL = new Set(["ar", "fa"]);
export type TKey = keyof Dict;

export function translator(lang: string) {
  const d = DICTS[lang] || en;
  return (k: TKey) => d[k] ?? en[k];
}

export function applyDocumentLanguage(lang: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
}

export function flag(code?: string | null): string {
  if (!code || code.length !== 2) return "🏳";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

let flagSupport: boolean | null = null;
/** Windows renders regional-indicator flags as two letters; detect colour glyph support once. */
export function supportsFlagEmoji(): boolean {
  if (flagSupport !== null) return flagSupport;
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return (flagSupport = false);
    ctx.font = "16px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("\u{1F1FA}\u{1F1FF}", 0, 0);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let coloured = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) coloured++;
    flagSupport = coloured > 10;
  } catch {
    flagSupport = false;
  }
  return flagSupport;
}
