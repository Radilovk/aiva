# Stripe setup — KASY

**Започни в TEST режим.** Той не изисква никаква верификация, фирма или банкова сметка —
работи веднага след регистрация с имейл. Целият платежен поток може да се тества от край
до край, докато регистрацията на фирмата още върви. Живият режим се включва после,
със същия скрипт и жив ключ.

---

## 1. Регистрация (5 минути)

1. Отвори [dashboard.stripe.com/register](https://dashboard.stripe.com/register) и създай акаунт
2. Потвърди имейла
3. Провери горе вдясно, че превключвателят е на **Test mode**

Пропусни „Activate your account“ / искането за фирмени данни — за тестовия режим не трябват.

## 2. Вземи тестовия ключ

**Developers → API keys → Secret key → Reveal test key**

Ключът започва с `sk_test_`. Той е таен — не го качвай в git и не го споделяй.

## 3. Създай продуктите (една команда)

От root на репото:

```bash
node scripts/stripe-setup.mjs sk_test_...
```

Скриптът създава плановете и **сам записва price ID-тата в `wrangler.jsonc`** — няма копи-пейст.
Безопасен е за повторно пускане: вече създадените цени се преизползват, не се правят дубликати.

| Флаг | Действие |
|---|---|
| *(без флаг)* | Създава само Plus месечен (€6.99) и годишен (€49.99, 7 дни пробен период) |
| `--with-pro` | Добавя и Pro Lifetime (€149 еднократно) |
| `--dry-run` | Показва какво би направил, без да пише нищо |
| `--live` | Задължителен при `sk_live_` ключ — защита срещу случаен запис в реалния акаунт |

> За старт се препоръчват **само Free + Plus**. По-малко объркване в UI-я, по-висока конверсия.
> Pro се добавя по-късно, когато има реални Pro-only функции.

## 4. Secrets в Cloudflare

```bash
cd workers
wrangler secret put STRIPE_SECRET_KEY      # същият ключ от стъпка 2
```

## 5. Webhook

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://aiva.radilov-k.workers.dev/api/stripe/webhook`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Копирай **Signing secret** (започва с `whsec_`):

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```

## 6. Customer Portal

Settings → Billing → Customer portal → **Enable**.
Включи *cancel subscription* и *update payment method* — така потребителите се
самообслужват и не пишат на теб.

## 7. Deploy и тест

```bash
cd workers && npm run deploy
```

Тест: приложението → Настройки → Абонамент → Plus Yearly → карта `4242 4242 4242 4242`,
произволна бъдеща дата и CVC. След успех `GET /api/subscription?user_id=...` трябва да
върне план `plus`.

## 8. Активиране на лимитите

В `wrangler.jsonc`:

```json
"SUBSCRIPTION_ENFORCED": "true"
```

Докато е `false`, всички имат пълен достъп (бета режим). След `true`:

- **Free:** 5 гласови сесии/ден, 50 задачи, без облачен календар
- **Plus:** 40 сесии/ден, неограничени задачи, пълен календар

> ⚠️ Не включвай това преди автентикацията да е готова. В момента `user_id` се генерира от
> клиента и не се проверява никъде, тоест лимитите се нулират с преинсталация.
> Виж [`docs/LAUNCH-PLAN.md`](docs/LAUNCH-PLAN.md) → Фаза 0.

---

## Преминаване към живи плащания

Изисква активиран Stripe акаунт (верификация на самоличност или фирма + банкова сметка).
След това — същият скрипт с жив ключ:

```bash
node scripts/stripe-setup.mjs sk_live_... --live
```

После повтори стъпки 4–7 с живия ключ и нов webhook в live режим.

**Ако смяташ да регистрираш фирма:** верифицирай Stripe акаунта директно като фирмата.
Смяната на типа на акаунта след верификация е трудна и понякога изисква нов акаунт.

---

## Правни страници

- `frontend/terms.html` — общи условия и възстановяване
- `frontend/privacy.html` — секция Stripe
- Линкове в Настройки

## Поддръжка

- Управление на абонамент: Настройки → „Управление на абонамента“ (Stripe Portal)
- Проблеми с webhook: Cloudflare Workers logs + Stripe Dashboard → Webhooks → event log
