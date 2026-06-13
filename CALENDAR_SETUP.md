# Интеграция с Календари (Google, Apple, Android Native)

Този документ описва архитектурата и стъпките за активиране на пълна двупосочна синхронизация (четене и запис) с календари в уеб версията и APK на AIVA.

## Архитектурна матрица (Пълен достъп)

| Екосистема | Уеб Версия (Бекенд: Cloudflare Worker) | Android APK (Локално устройство) |
| --- | --- | --- |
| **Google** | **OAuth 2.0 REST API** (активно) | **OAuth 2.0** (споделен токен с уеб) |
| **Outlook** | **Microsoft Graph API** (активно) | **Microsoft Graph API** (споделен токен) |
| **Apple (iCloud)** | **CalDAV клиент** (препоръчително) | **Native Capacitor Plugin** (директен достъп) |

---

## 1. Google и Microsoft Outlook (Облачна синхронизация)
Синхронизацията минава изцяло през **Cloudflare Worker (Бекенд)**, което гарантира еднакво поведение в уеб и APK.

### Стъпки за конфигуриране:
1.  **Регистрация на приложение:**
    *   **Google:** В Google Cloud Console създайте OAuth 2.0 Client ID (Web Application). Добавете `https://aiva.radilov-k.workers.dev/settings.html` в Redirect URIs.
    *   **Microsoft:** В Azure Portal (App Registrations) регистрирайте приложение с разрешения `Calendars.ReadWrite` и `offline_access`.
2.  **Настройка на Secrets в Cloudflare:**
    ```bash
    # Google
    wrangler secret put GOOGLE_CLIENT_ID
    wrangler secret put GOOGLE_CLIENT_SECRET
    # Microsoft
    wrangler secret put MICROSOFT_CLIENT_ID
    wrangler secret put MICROSOFT_CLIENT_SECRET
    ```
3.  **Поток в приложението:**
    Потребителят натиска "Свържи" -> Оторизира се -> Избира конкретен календар от списъка. Бекендът записва `refresh_token` и `calendarId` за автоматичен запис/четене от AI асистента.

---

## 2. Apple Calendar (iCloud)
За пълен достъп (не само четене чрез ICS) се използват два подхода:

### А. В Уеб версията (CalDAV)
Потребителят въвежда **Apple ID** и **App-Specific Password**. Worker-ът действа като CalDAV клиент:
1. Извиква `PROPFIND` към `https://caldav.icloud.com/`.
2. Извлича списъка с календари.
3. Записва събития чрез `PUT` заявки по CalDAV протокола.

### Б. В APK версията (Native)
Използва се Capacitor плъгин (напр. `AivaCalendar`), който изисква директен достъп до системния календар на Android.
*   **Разрешения в AndroidManifest.xml:**
    ```xml
    <uses-permission android:name="android.permission.READ_CALENDAR" />
    <uses-permission android:name="android.permission.WRITE_CALENDAR" />
    ```

---

## 3. Текущо състояние на имплементацията
*   ✅ **Google Calendar OAuth**: Напълно имплементирано (Бекенд + Фронтенд).
*   ✅ **Microsoft Outlook OAuth**: Напълно имплементирано (Бекенд + Фронтенд).
*   ✅ **Native Android Sync**: Имплементирано за APK версията.
*   ⚠️ **Apple iCloud (CalDAV)**: В момента се поддържа чрез **ICS абонамент** (само четене) и **Manual Share** (запис чрез .ics файл). Пълната CalDAV интеграция за уеб е планирана за бъдещо разширение.

---

## 4. Гласово управление (AI Асистент)
Асистентът е обучен да използва следните инструменти за управление на календара:
*   `read_calendar_events`: Чете събития от избрания календар.
*   `edit_calendar_event`: Редактира съществуващи събития.
*   `delete_calendar_event`: Изтрива събития след потвърждение.
