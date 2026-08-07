#!/usr/bin/env python3
"""
Patch AndroidManifest.xml and MainActivity for AIVA calendar + notification support.
Run from repo root after `npx cap add android && npx cap sync android`.
"""
import os
import re
import sys

MANIFEST = 'android/app/src/main/AndroidManifest.xml'
MAIN_ACTIVITY = 'android/app/src/main/java/com/aiva/assistant/MainActivity.java'

if not os.path.exists(MANIFEST):
    print(f'ERROR: {MANIFEST} not found. Run `npx cap add android` first.')
    sys.exit(1)

with open(MANIFEST, 'r') as f:
    content = f.read()

PERMISSIONS = """
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.READ_CALENDAR" />
    <uses-permission android:name="android.permission.WRITE_CALENDAR" />
"""

if 'WAKE_LOCK' not in content:
    content = content.replace('<application', PERMISSIONS + '\n    <application', 1)
    print('✅ Added notification + microphone + calendar permissions')

if 'READ_CALENDAR' not in content:
    content = content.replace(
        '<application',
        '    <uses-permission android:name="android.permission.READ_CALENDAR" />\n'
        '    <uses-permission android:name="android.permission.WRITE_CALENDAR" />\n'
        '    <application',
        1,
    )
    print('✅ Added calendar permissions')

if 'RECORD_AUDIO' not in content:
    content = content.replace(
        '<application',
        '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n'
        '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n'
        '    <application',
        1,
    )
    print('✅ Added microphone permissions')

if 'READ_CONTACTS' not in content:
    content = content.replace(
        '<application',
        '    <uses-permission android:name="android.permission.READ_CONTACTS" />\n'
        '    <application',
        1,
    )
    print('✅ Added READ_CONTACTS permission')

# Android 11+ package visibility — lets isInstalled() / resolveActivity() see maps,
# messaging, and dialer handlers without QUERY_ALL_PACKAGES.
QUERIES_BLOCK = """
    <queries>
        <package android:name="com.google.android.apps.maps" />
        <package android:name="com.huawei.maps.app" />
        <package android:name="com.waze" />
        <package android:name="com.whatsapp" />
        <package android:name="com.viber.voip" />
        <package android:name="org.telegram.messenger" />
        <package android:name="com.google.android.gm" />
        <package android:name="com.android.chrome" />
        <package android:name="com.mi.globalbrowser" />
        <package android:name="com.huawei.browser" />
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="geo" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="google.navigation" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SENDTO" />
            <data android:scheme="smsto" />
        </intent>
        <intent>
            <action android:name="android.intent.action.DIAL" />
            <data android:scheme="tel" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SEND" />
            <data android:mimeType="text/plain" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SET_ALARM" />
        </intent>
    </queries>
"""

if '<queries>' not in content:
    content = content.replace('<application', QUERIES_BLOCK + '\n    <application', 1)
    print('✅ Added Android 11+ <queries> for package visibility')

# USE_EXACT_ALARM (Android 14+): granted automatically for calendar/alarm apps,
# so reminders keep firing exactly on time without the revocable
# SCHEDULE_EXACT_ALARM special-access toggle.
if 'USE_EXACT_ALARM' not in content:
    content = content.replace(
        '<application',
        '    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />\n'
        '    <application',
        1,
    )
    print('✅ Added USE_EXACT_ALARM permission')

# Lets the app show the "ignore battery optimizations" consent dialog, so
# aggressive OEM battery managers (MIUI, EMUI, ColorOS...) don't kill reminders.
if 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' not in content:
    content = content.replace(
        '<application',
        '    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />\n'
        '    <application',
        1,
    )
    print('✅ Added REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission')

RECEIVER = """
        <receiver android:name="com.capacitorjs.plugins.localnotifications.AivaNotificationReceiver"
                  android:exported="false">
            <intent-filter>
                <action android:name="com.aiva.assistant.NOTIFICATION_ACTION" />
            </intent-filter>
        </receiver>
"""

if 'AivaNotificationReceiver' not in content:
    content = content.replace('</application>', RECEIVER + '\n    </application>', 1)
    print('✅ Added AivaNotificationReceiver')

ACCESSIBILITY_SERVICE = """
        <service
            android:name="com.aiva.assistant.AivaShortcutAccessibilityService"
            android:exported="false"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/aiva_shortcut_service_config" />
        </service>
"""

if 'AivaShortcutAccessibilityService' not in content:
    content = content.replace('</application>', ACCESSIBILITY_SERVICE + '\n    </application>', 1)
    print('✅ Added AivaShortcutAccessibilityService')

# Disable themed/monochrome launcher icon (keeps full-color maskable tile)
THEMED_ICON_META = (
    '        <meta-data android:name="com.google.android.apps.nexuslauncher.THEMED_ICON_ENABLED" '
    'android:value="false" />\n'
)
if 'THEMED_ICON_ENABLED' not in content:
    content = content.replace('<application', THEMED_ICON_META + '    <application', 1)
    print('✅ Disabled launcher themed icon tinting')

# Circular launchers + MIUI install UI use android:roundIcon (API 25+)
if 'android:roundIcon' not in content and 'android:icon="@mipmap/ic_launcher"' in content:
    content = content.replace(
        'android:icon="@mipmap/ic_launcher"',
        'android:icon="@mipmap/ic_launcher"\n        android:roundIcon="@mipmap/ic_launcher_round"',
        1,
    )
    print('✅ Added android:roundIcon=@mipmap/ic_launcher_round')

with open(MANIFEST, 'w') as f:
    f.write(content)

# Patch MainActivity for lock-screen launch + plugin registration
PATCHED_MAIN = 'android-res/java/com/aiva/assistant/MainActivity.java'
if os.path.exists(PATCHED_MAIN):
    import shutil
    os.makedirs(os.path.dirname(MAIN_ACTIVITY), exist_ok=True)
    shutil.copy2(PATCHED_MAIN, MAIN_ACTIVITY)
    print('✅ Installed patched MainActivity')

    # Ensure lock-screen flags on launcher activity
    if os.path.exists(MANIFEST):
        with open(MANIFEST, 'r') as f:
            manifest = f.read()
        activity_attrs = (
            'android:showWhenLocked="true"\n'
            '            android:turnScreenOn="true"'
        )
        if 'android:showWhenLocked' not in manifest:
            manifest = manifest.replace(
                'android:name=".MainActivity"',
                'android:name=".MainActivity"\n            ' + activity_attrs,
                1,
            )
            with open(MANIFEST, 'w') as f:
                f.write(manifest)
            print('✅ Added lock-screen launch flags to MainActivity')
elif os.path.exists(MAIN_ACTIVITY):
    print(f'⚠ Patched MainActivity template missing — keeping existing {MAIN_ACTIVITY}')
else:
    print(f'⚠ MainActivity not found at {MAIN_ACTIVITY} — plugin registration skipped')

# Copy accessibility XML + strings
XML_SRC = 'android-res/xml/aiva_shortcut_service_config.xml'
XML_DST = 'android/app/src/main/res/xml/aiva_shortcut_service_config.xml'
if os.path.exists(XML_SRC):
    os.makedirs(os.path.dirname(XML_DST), exist_ok=True)
    import shutil
    shutil.copy2(XML_SRC, XML_DST)
    print('✅ Copied shortcut accessibility config XML')

STRINGS_SRC = 'android-res/values/strings.xml'
STRINGS_DST = 'android/app/src/main/res/values/aiva_strings.xml'
if os.path.exists(STRINGS_SRC):
    os.makedirs(os.path.dirname(STRINGS_DST), exist_ok=True)
    import shutil
    shutil.copy2(STRINGS_SRC, STRINGS_DST)
    print('✅ Copied AIVA strings resource')

# Launch theme: solid app background — no splash drawable
STYLES = 'android/app/src/main/res/values/styles.xml'
if os.path.exists(STYLES):
    import re
    with open(STYLES, 'r') as f:
        styles = f.read()

    if 'Theme.SplashScreen' in styles:
        styles = styles.replace(
            'parent="Theme.SplashScreen"',
            'parent="Theme.AppCompat.DayNight.NoActionBar"',
        )
        print('✅ Replaced Theme.SplashScreen with AppCompat')

    launch_style = '''    <style name="AppTheme.NoActionBarLaunch" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:windowBackground">@color/app_background</item>
        <item name="android:statusBarColor">@color/app_background</item>
        <item name="android:navigationBarColor">@color/app_background</item>
        <item name="android:background">@null</item>
    </style>'''

    if 'AppTheme.NoActionBarLaunch' in styles:
        styles = re.sub(
            r'\s*<item name="windowSplashScreen[^"]*">[^<]*</item>',
            '',
            styles,
        )
        styles = re.sub(
            r'\s*<item name="postSplashScreenTheme">[^<]*</item>',
            '',
            styles,
        )
        styles = re.sub(
            r'<style name="AppTheme\.NoActionBarLaunch"[^>]*>.*?</style>',
            launch_style,
            styles,
            count=1,
            flags=re.DOTALL,
        )
        with open(STYLES, 'w') as f:
            f.write(styles)
        print('✅ Patched launch theme: android:windowBackground=@color/app_background')

# Launcher icon: Capacitor ships #FFFFFF background → white box on install screen
LAUNCHER_BG = 'android/app/src/main/res/values/ic_launcher_background.xml'
LAUNCHER_BG_FIX = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#050508</color>
</resources>
'''
if os.path.exists(LAUNCHER_BG):
    with open(LAUNCHER_BG, 'r') as f:
        bg = f.read()
    if '#050508' not in bg:
        with open(LAUNCHER_BG, 'w') as f:
            f.write(LAUNCHER_BG_FIX)
        print('✅ ic_launcher_background → #050508 (dark brand launcher tile)')

VECTOR_FG = 'android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml'
if os.path.exists(VECTOR_FG):
    os.remove(VECTOR_FG)
    print('✅ Removed Capacitor default vector ic_launcher_foreground.xml')

BUILD_GRADLE = 'android/app/build.gradle'
if os.path.exists(BUILD_GRADLE):
    with open(BUILD_GRADLE, 'r') as f:
        gradle = f.read()
    gradle_changed = False

    if 'abiFilters' not in gradle:
        gradle = gradle.replace(
            'versionName "1.0"',
            'versionName "1.0"\n'
            '        ndk {\n'
            '            abiFilters "arm64-v8a"\n'
            '        }',
            1,
        )
        gradle_changed = True

    old_release = """    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }"""
    new_release = """    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
            signingConfig signingConfigs.debug
        }
    }"""
    if 'shrinkResources' not in gradle and old_release in gradle:
        gradle = gradle.replace(old_release, new_release, 1)
        gradle_changed = True

    if gradle_changed:
        with open(BUILD_GRADLE, 'w') as f:
            f.write(gradle)
        print('✅ Patched build.gradle (arm64 release, minify + shrink)')

print('✅ Android patches applied successfully')
