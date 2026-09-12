# KASY / AIVA — Статус и пътна карта

*Последна актуализация: септември 2026 · Домейн: [ai-kasy.online](https://ai-kasy.online/)*

Единен списък: **какво е готово**, **какво чака**, **защо чака** и **кой какво прави**.

---

## Как да четеш таблицата

| Колона | Значение |
|--------|----------|
| **Статус** | ✅ Готово · 🔄 В процес · ⏳ Чака · 👤 Ти (собственик) |
| **Кой** | Агент/код · Ти · Google/Stripe/Cloudflare · Тест на устройство |

**„Автоматично“ в приложението** = OAuth flow, запазване на настройки, синхронизация след свързване.  
**„Ръчно“** = secrets в Cloudflare, DNS, Stripe dashboard, физически телефон — нещо, което само собственикът може да направи външна конзола.

---

## Фаза A — Сигурност и инфраструктура

| # | Стъпка | Статус | Кой | Бележки |
|---|--------|--------|-----|---------|
| A1 | API автентикация (`Authorization: Bearer`) | ✅ | Код | PR #139 |
| A2 | Криптиране OAuth токени (AES-GCM) | ✅ | Код | PR #139 |
| A3 | ICS feed с secret token (не `user_id`) | ✅ | Код | PR #139 |
| A4 | CORS whitelist | ✅ | Код | |
| A5 | `TOKEN_ENCRYPTION_KEY` в Cloudflare | 👤 ⏳ | Ти | `wrangler secret put TOKEN_ENCRYPTION_KEY` |
| A6 | Worker deploy (Workers Builds CI) | ✅ | Auto | Merge в `main` → Cloudflare deploy; fix sep. 2026 (PR #146 + stub) |

---

## Фаза B — Продукт и публичен сайт

| # | Стъпка | Статус | Кой | Бележки |
|---|--------|--------|-----|---------|
| B1 | Custom domain `ai-kasy.online` | ✅ | Код + DNS | PR #137 |
| B2 | Google OAuth verification | ✅ | Google | Одобрено авг. 2026 |
| B3 | Google Calendar в настройки (опростен UI) | ✅ | Код | PR #140–141 |
| B4 | Landing page (9 езика) | ✅ | Код | |
| B5 | GitHub Pages deploy | ✅ | Auto | При merge в `main` |
| B6 | AI SEO (schema, sitemap, robots) | ✅ | Код | PR #143–144 |
| B7 | About страница за AI/crawlers | ✅ | Код | `frontend/about.html` |
| B8 | Преводи info бутони (i) в настройки | ✅ | Код | `i18n-device-access.js` |

---

## Фаза C — Android APK (реално устройство)

| # | Стъпка | Статус | Кой | Защо чака |
|---|--------|--------|-----|----------|
| C1 | Build APK | ✅ | Код | |
| C2 | Тест на физически телефон | ⏳ | Ти | Нужен реален Android (Xiaomi/Samsung и др.) |
| C3 | Глас + календар + бутони за звук | ⏳ | Ти | Потвърждение на OEM разрешения |
| C4 | Фонов режим / достъпност | ⏳ | Ти | Системни настройки на телефона |

**Как тестваш:** инсталирай APK → Настройки → „Настрой разрешения“ → потвърди всеки диалог → тествай глас и календар.

---

## Фаза D — Монетизация (Stripe)

| # | Стъпка | Статус | Кой | Защо чака |
|---|--------|--------|-----|----------|
| D1 | Stripe интеграция в кода | ✅ | Код | |
| D2 | Продукти и цени в Stripe | 👤 ⏳ | Ти | `STRIPE_SETUP.md` |
| D3 | `STRIPE_SECRET_KEY` + webhook secret | 👤 ⏳ | Ти | Cloudflare secrets |
| D4 | `SUBSCRIPTION_ENFORCED: true` | 👤 ⏳ | Ти | Само когато искаш да пуснеш лимити |
| D5 | Тест с карта 4242… | 👤 ⏳ | Ти | Test mode |

Докато `SUBSCRIPTION_ENFORCED` е `false` — всички имат пълен достъп (бета).

---

## Фаза E — AI видимост (мониторинг)

| # | Стъпка | Статус | Кой | Бележки |
|---|--------|--------|-----|---------|
| E1 | Технически SEO | ✅ | Код | Score ~94/100 в AI Visibility |
| E2 | Периодичен анализ в dashboard | 🔄 | Ти | Седмично/месечно — не fix |
| E3 | CNAME към ai-visibility-edge | ❌ Не е нужно | — | Само за техния SaaS edge |
| E4 | „Грешни цитати“ от AI модели | — | — | Не се оправя с код; шум в метриката |

---

## Бърз deploy checklist (ти)

```bash
# 1. Secrets (еднократно или при смяна)
wrangler secret put TOKEN_ENCRYPTION_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# 2. Worker
cd workers && npm run deploy

# 3. Frontend — автоматично при push към main (GitHub Pages)
```

**След deploy провери:**
- https://ai-kasy.online/frontend/ — няма 401 в конзолата
- Настройки → Свържи Google Calendar
- https://ai-kasy.online/sitemap.xml
- `node scripts/beta-smoke-test.mjs`

---

## Често срещани обърквания

| Въпрос | Отговор |
|--------|---------|
| „Казва без човешка намеса, но иска CMS“ | SEO текстът е в HTML в repo — не е нужен CMS. AI Visibility draft-овете с `[placeholder]` не ги копирай. |
| „Няма цени на сайта“ | Има на landing `#pricing` и в JSON-LD: €0, €6.99, €49.99. |
| „Info (i) бутоните са на английски“ | Поправено с локализирани OEM съвети вместо raw hints от APK. |
| „Какво прави агентът vs мен?“ | Агент: код, PR, тестове. Ти: secrets, deploy Worker, Stripe, реален телефон. |

---

## Полезни файлове

| Файл | Съдържание |
|------|------------|
| `GOOGLE_OAUTH_SETUP.md` | Google Console, redirect URI, secrets |
| `STRIPE_SETUP.md` | Продукти, webhook, лимити |
| `PROJECT-REVIEW.md` | Технически одит (частично остарял статус) |
| `frontend/about.html` | Публично описание + FAQ за AI/crawlers |
