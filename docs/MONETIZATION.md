# KAYA — монетизация и Stripe интеграция

## Статус на тестове (след deploy)

```bash
node scripts/beta-smoke-test.mjs
```

27/27 проверки — включително `PATCH /done` с `user_id`, `POST /api/profile`, ICS feed.

---

## Позициониране (маркетинг)

**KAYA не е todo app.** Това е **гласов личен асистент за задачи и календар** — говориш, той разбира тона, създава задачи, синхронизира календара и напомня.

**Целева аудитория (приоритет):**

1. **Заети професионали** (25–45) — много срещи, нужда от „кажи и забрави“
2. **Самонаемащи / фрийлансери** — календар + задачи без клавиатура
3. **Android power users** — APK, hardware shortcut, локални напомняния
4. **Международни потребители** — 9 езика (не само България)

**Обещание (value proposition):**

> „Говори. KAYA слуша, планира и напомня — календарът и задачите се движат сами.“

**Конкурентно поле:**

| Продукт | Сила | Слабост спрямо KAYA |
|---------|------|---------------------|
| Todoist / TickTick | Задачи, интеграции | Няма жив гласов диалог |
| Google Assistant / Siri | Глас | Слаби задачи + календар workflow |
| Motion / Reclaim | AI планиране | Скъпо, без локален APK UX |
| ChatGPT voice | Генерален AI | Няма календар, няма напомняния |

**KAYA продава:** *скорост + емоционален интелект + календар в едно*, не „още един списък“.

---

## Модел: Freemium + абонамент

Три нива — ясни, без объркване. **Не повече от 3 плана** на старта.

### 1. KAYA Free (Starter)

**Цена:** €0  
**Цел:** Вирусен вход, habit formation, демо на гласа.

| Функция | Лимит |
|---------|--------|
| Гласови сесии | **5 / ден** (след deploy на tier logic) |
| Задачи | До **50 активни** |
| Календар UI | Ден / седмица / месец |
| Локални напомняния | ✓ (APK / PWA scheduler) |
| ICS абонамент (read-only sync) | ✓ |
| Облачен календар (Google/Outlook write) | ✗ |
| Вечерен AI brief | 1× седмично |
| Google Grounding (`discuss_task`) | ✗ |
| Езици | Всички 9 |
| Export JSON | ✓ |

**Защо тези лимити:** 5 гласови сесии = достатъчно да „усетиш магията“, но power user ще удари paywall за 2–3 дни. Основният разход е Gemini Live — лимитът пази margin.

### 2. KAYA Plus (основен платен план)

**Цена (препоръчително за launch):**

| Период | EUR | BGN (ориентировъчно) |
|--------|-----|----------------------|
| Месечен | **€6.99** | ~13.50 лв |
| Годишен | **€49.99** (~€4.17/мес) | ~98 лв |
| 7-дневен trial | Безплатен (само годишен) | — |

**Цел:** 80% от платящите — един ясен ъпгрейд.

| Функция | Plus |
|---------|------|
| Гласови сесии | **40 / ден** |
| Задачи | Неограничени |
| Облачен календар (Google, Outlook, iCloud) | ✓ |
| Вечерен AI brief | Всеки ден |
| Google Grounding | ✓ |
| Voice preview | Неограничен |
| Hardware shortcut (APK) | ✓ |
| Приоритет при rate limits | ✓ |

**Messaging:** „Неограничен глас + пълен календар“ — не „премахваме реклами“ (няма реклами).

### 3. KAYA Pro (power users / early adopters)

**Цена:**

| Период | EUR |
|--------|-----|
| Месечен | **€12.99** |
| Годишен | **€99** |
| Lifetime (launch offer, лимит 500 бр.) | **€149** еднократно |

| Функция | Pro |
|---------|-----|
| Гласови сесии | **100 / ден** (fair use) |
| Всичко от Plus | ✓ |
| Модел избор (когато има алтернативи) | ✓ |
| Ранен достъп до нови функции | ✓ |
| Семейно споделяне (бъдеще: 2 акаунта) | roadmap |

**Не въвеждай Pro веднага** ако нямаш 2+ уникални Pro-only features — може да стартираш само Free + Plus и добавиш Pro след 3 месеца.

---

## Алтернатива: само 2 плана (препоръка за v1)

За първи Stripe launch — **само Free + Plus**. По-висока конверсия, по-малко объркване в UI и в Stripe Dashboard.

---

## Paywall моменти (кога да показваме ъпгрейд)

1. **Дневен лимит на глас** — след 5-та сесия (Free): „Достигна дневния лимит. Plus = 40 разговора/ден.“
2. **Свързване Google/Outlook** — при tap „Свържи Google“ на Free
3. **discuss_task с grounding** — при първи voice discuss на задача
4. **Вечерен brief** — втори brief в същата седмица на Free
5. **50+ активни задачи** — при създаване на 51-ва

Не paywall-вай: ръчно създаване на задачи, ICS read, локални напомняния — това задържа Free users.

---

## Stripe — техническа интеграция (KAYA + Cloudflare Worker)

В този repo **няма готов Stripe модул**. Шаблонът по-долу съвпада с типичен BioCode/NutriPlan worker pattern и може да се адаптира от съществуващ Stripe код (ако имате в друг repo).

### Stripe Products (Dashboard)

| Product | Price ID (пример) | Тип |
|---------|-------------------|-----|
| KAYA Plus Monthly | `price_plus_monthly` | recurring monthly |
| KAYA Plus Yearly | `price_plus_yearly` | recurring yearly |
| KAYA Pro Lifetime | `price_pro_lifetime` | one-time (optional) |

### Worker endpoints

```
POST /api/stripe/checkout     → Stripe Checkout Session (mode: subscription)
POST /api/stripe/portal       → Customer Portal (управление / отказ)
POST /api/stripe/webhook      → stripe.webhooks.constructEvent (raw body)
GET  /api/subscription        → { tier, status, limits, period_end }
```

### Secrets (wrangler)

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

### KV / D1 запис

```
sub:{user_id} → {
  tier: "free" | "plus" | "pro",
  stripe_customer_id,
  stripe_subscription_id,
  status: "active" | "past_due" | "canceled",
  current_period_end,
  limits: { sessions_per_day: 40 }
}
```

### Връзка user_id ↔ Stripe

- Checkout `client_reference_id` = `user_id` (aiva_user_id от localStorage)
- Webhook `checkout.session.completed` → запис в KV
- `customer.subscription.updated/deleted` → актуализация на tier

### Промяна на лимити

В `POST /api/token` — чети tier от KV преди `incrementDailyLimit`:

```typescript
const tier = await getSubscriptionTier(env, userId);
const userLimit = TIER_LIMITS[tier].sessions_per_day;
```

### Frontend

- `frontend/lib/subscription.js` — `getSubscription()`, `openCheckout()`, `openPortal()`
- Settings → секция „Абонамент“ с текущ план и CTA
- Paywall modal при 429 от `/api/token`

### Android APK / Capacitor

- Checkout: **Stripe Checkout в браузър** (`Browser.open`) — не in-app purchase на старта (бърз launch)
- По-късно: Google Play Billing за EU compliance в store listing

### Compliance

- Privacy policy: добави Stripe as payment processor
- EU: B2C 14-day refund policy (ако продаваш в България)
- Invoice: Stripe Customer Portal + email receipts

---

## GTM (go-to-market) — първи 90 дни

1. **Launch offer:** годишен Plus −30% за първите 200 абоната
2. **Lifetime Pro** само за APK early adopters (email list)
3. **Контент:** „5 неща които казваш на KAYA вместо да пишеш в календара“ (BG + EN)
4. **Referral (v2):** +7 дни Plus при покана на приятел (Stripe coupon)

**KPI:**

- Free → Plus conversion: цел **3–5%** (voice apps)
- D7 retention Free: **>25%**
- ARPU платени: **~€5.5** (mix monthly/yearly)

---

## Roadmap след monetization v1

1. Stripe Checkout + webhook + tier limits
2. Paywall UI + i18n за billing strings
3. Google Play Billing (ако APK в Play Store)
4. Family / team plan
5. Usage dashboard в Settings („използвах 4/5 гласови днес“)

---

## Референция: какво вече има в KAYA (за gating)

| Ресурс | Къде се контролира |
|--------|-------------------|
| Гласови сесии/ден | `workers/src/index.ts` → `/api/token` |
| Voice preview | `/api/voice-preview` |
| Cloud calendar | `calendar.ts` + settings UI |
| Evening brief | `cron.ts` + `/api/brief` |
| Grounding | `settings.googleGrounding` + session instructions |
| Task count | `tasks.ts` + нов лимит при create |
