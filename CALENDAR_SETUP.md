# Интеграция с Календари (Google, Apple, Android Native)

Този документ описва архитектурата и стъпките за активиране на **пълен двупосочен достъп (четене и запис)** с календари в уеб версията и APK на AIVA.

## Архитектурна матрица (Пълен достъп)

| Екосистема | Уеб Версия (Бекенд: Cloudflare Worker) | Android APK (Локално устройство) |
| --- | --- | --- |
| **Google** | **OAuth 2.0 REST API** (активно) | **OAuth 2.0** (споделен токен с уеб) |
| **Outlook** | **Microsoft Graph API** (активно) | **Microsoft Graph API** (споделен токен) |
| **Apple (iCloud)** | **CalDAV клиент** (препоръчително за 100% покритие) | **CalDAV през Бекенд** (същият подход като уеб) |

---

## 1. Google и Microsoft Outlook (Облачна синхронизация)
Синхронизацията минава изцяло през **Cloudflare Worker (Бекенд)**, което гарантира еднакво поведение в уеб и APK.

### Стъпки за конфигуриране:
1.  **Регистрация на приложение:**
    *   **Google:** В Google Cloud Console създайте OAuth 2.0 Client ID (Web Application). Добавете `https://aiva.radilov-k.workers.dev/settings.html` в Redirect URIs.
    *   **Microsoft:** В Azure Portal (App Registrations) регистрирайте приложение с разрешения `Calendars.ReadWrite` и `offline_access`.
2.  **Настройка на Secrets в Cloudflare:**
    ```bash
    wrangler secret put GOOGLE_CLIENT_ID
    wrangler secret put GOOGLE_CLIENT_SECRET
    wrangler secret put MICROSOFT_CLIENT_ID
    wrangler secret put MICROSOFT_CLIENT_SECRET
    ```
3.  **Поток в приложението:**
    Потребителят натиска "Свържи" -> Оторизира се -> Избира конкретен календар. Бекендът записва `refresh_token` и `calendarId`.

---

## 2. Apple Calendar (iCloud) — Пълен достъп чрез CalDAV
Тъй като Apple няма OAuth REST API, единственият начин за двупосочен достъп (четене/запис) от уеб и Android APK е чрез **CalDAV** протокола, имплементиран в бекенда.

### А. UX Поток (Уеб и APK)
1. Потребителят отива на `Настройки` -> `Свържи Apple Календар`.
2. Въвежда:
    *   **Apple ID** (напр. `user@icloud.com`)
    *   **App-Specific Password** (генерирана от appleid.apple.com)
3. Натиска "Свържи".

### Б. Бекенд имплементация (Cloudflare Worker)
Бекендът изпълнява следните стъпки чрез HTTP заявки:
1.  **Discovery (PROPFIND):** Открива специфичния сървърен възел (home-set URL) на потребителя чрез `https://caldav.icloud.com/`.
2.  **Listing (PROPFIND):** Извлича списък с календарите (Личен, Работа) и техните пътища (`href`).
3.  **Sync (PUT/DELETE):** Записва събития чрез изпращане на `.ics` стрингове с `PUT` заявки директно към адреса на избрания календар.

### В. Защо това решава проблема?
Тъй като логиката е в Cloudflare Worker, тя работи идентично за уеб версията и за Android APK. Няма нужда от нативни плъгини, защото и двете платформи комуникират с iCloud през твоя бекенд.

---

## 3. Текущо състояние на имплементацията
*   ✅ **Google Calendar OAuth**: Напълно имплементирано (Бекенд + Фронтенд).
*   ✅ **Microsoft Outlook OAuth**: Напълно имплементирано (Бекенд + Фронтенд).
*   ✅ **Native Android Sync**: Поддържа се за локални Android календари в APK.
*   ⚠️ **Apple iCloud (CalDAV)**: В момента се поддържа чрез **ICS абонамент** (само четене) и **Manual Share**. Пълната CalDAV интеграция е препоръчителният архитектурен път за двупосочен достъп.

---

## 4. Гласово управление (AI Асистент)
Асистентът използва инструментите `read_calendar_events`, `edit_calendar_event` и `delete_calendar_event`, за да управлява свързаните календари чрез бекенда.
