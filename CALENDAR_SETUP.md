# Интеграция с Календари (Google, Apple, Android Native)

Този документ описва стъпките за активиране на интеграцията с календари в уеб версията и APK на AIVA.

## 1. Google Calendar (Уеб и APK)
Интеграцията се извършва през Cloudflare Worker чрез OAuth 2.0.

### Стъпки за конфигуриране:
1.  **Google Cloud Console:**
    *   Създайте нов проект или изберете съществуващ.
    *   Активирайте **Google Calendar API**.
    *   Отидете на **Credentials** -> **Create Credentials** -> **OAuth 2.0 Client ID** (тип: Web Application).
    *   Добавете `https://aiva.radilov-k.workers.dev/settings.html` в **Authorized redirect URIs**.
2.  **Настройка на Secrets в Cloudflare:**
    Изпълнете следните команди в терминала (в директория `workers`):
    ```bash
    wrangler secret put GOOGLE_CLIENT_ID
    wrangler secret put GOOGLE_CLIENT_SECRET
    ```
    Въведете съответните стойности от Google Cloud Console.
3.  **Активиране в приложението:**
    Отидете в **Настройки** -> **Календар**, натиснете **Свържи Google**, оторизирайте се и изберете календар.

## 2. Microsoft Outlook Calendar
Аналогично на Google, поддържа се интеграция чрез Azure AD.

### Стъпки:
1.  Регистрирайте приложение в **Azure Portal (App Registrations)**.
2.  Добавете API разрешения за `Calendars.ReadWrite` и `offline_access`.
3.  Задайте Secrets:
    ```bash
    wrangler secret put MICROSOFT_CLIENT_ID
    wrangler secret put MICROSOFT_CLIENT_SECRET
    ```

## 3. Apple Calendar (iOS и Уеб)
Използва се метод на абонамент или директно споделяне на файлове.

### Метод А: Абонамент (Автоматичен)
1.  В **Настройки** -> **Календар** изберете **"Автоматично — абонамент"**.
2.  Натиснете бутона **Apple Calendar** или копирайте `webcal://` линка в приложението Calendar на iOS/macOS.

### Метод Б: Ръчно споделяне
*   В детайлите на задача натиснете **"Добави в календара"**. Приложението ще генерира `.ics` файл и ще отвори системното меню за споделяне.

## 4. Native Android Интеграция (APK)
Асистентът може да пише директно в системния календар на Android.

### Стъпки:
1.  **Разрешения в AndroidManifest.xml:**
    Проверете дали следните редове са налични:
    ```xml
    <uses-permission android:name="android.permission.READ_CALENDAR" />
    <uses-permission android:name="android.permission.WRITE_CALENDAR" />
    ```
2.  **Настройка:**
    В **Настройки** -> **Календар** изберете режим **"Директно в календара на телефона (Android APK)"** и свържете локален календар.

## 5. Гласово управление
След настройка, можете да използвате команди като:
*   *"Какво имам в календара за утре?"*
*   *"Промени часа на срещата в календара"*
*   *"Изтрий събитието от календара"*

Асистентът използва инструментите `read_calendar_events`, `edit_calendar_event` и `delete_calendar_event` за тези операции.
