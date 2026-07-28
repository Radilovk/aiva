# Stripe setup — KAYA (≈10 минути)

Следвайте **само тези стъпки**. Останалата интеграция (API, UI, правни страници, лимити) е в кода.

## 1. Stripe Dashboard

1. Влезте в [https://dashboard.stripe.com](https://dashboard.stripe.com)
2. Активирайте **Customer Portal**: Settings → Billing → Customer portal → Enable
3. Включете cancel subscription и update payment method

## 2. Създайте продукти (автоматично)

От root на репото, с **Secret key** (test mode за начало):

```bash
export STRIPE_SECRET_KEY=sk_test_...
node scripts/stripe-setup.mjs
```

Скриптът създава:
- KAYA Plus Monthly — €6.99/мес
- KAYA Plus Yearly — €49.99/год (7-day trial)
- KAYA Pro Lifetime — €149 еднократно (опционално)

Копирайте изведените `STRIPE_PRICE_*` в `wrangler.jsonc` → `vars`.

## 3. Secrets в Cloudflare

```bash
cd workers
wrangler secret put STRIPE_SECRET_KEY      # sk_live_... или sk_test_...
wrangler secret put STRIPE_WEBHOOK_SECRET  # след стъпка 4
```

## 4. Webhook

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://aiva.radilov-k.workers.dev/api/stripe/webhook`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Копирайте **Signing secret** → `wrangler secret put STRIPE_WEBHOOK_SECRET`

## 5. Deploy

```bash
cd workers
npm run deploy
```

## 6. Активиране на лимити (launch)

В `wrangler.jsonc`:

```json
"SUBSCRIPTION_ENFORCED": "true"
```

Докато е `false`, всички потребители имат пълен достъп (бета). След `true`:
- Free: 5 гласови сесии/ден, 50 задачи, без cloud calendar
- Plus: 40 сесии/ден, неограничени задачи, пълен календар

## 7. Тест (test mode)

1. Отворете приложението → Настройки → Абонамент
2. Изберете Plus Yearly → Stripe Checkout с карта `4242 4242 4242 4242`
3. След успех: планът трябва да е Plus (`GET /api/subscription?user_id=...`)

## Правни страници (готови)

- `frontend/terms.html` — общи условия и възстановяване
- `frontend/privacy.html` — секция Stripe
- Линкове в Settings

## Поддръжка

- Управление на абонамент: Settings → „Управление на абонамента“ (Stripe Portal)
- Проблеми с webhook: Cloudflare Workers logs + Stripe Dashboard → Webhooks → event log
