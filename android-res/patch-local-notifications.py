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
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.READ_CALENDAR" />
    <uses-permission android:name="android.permission.WRITE_CALENDAR" />
"""

if 'POST_NOTIFICATIONS' not in content:
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

with open(MANIFEST, 'w') as f:
    f.write(content)

# Copy patched MainActivity (registers plugins + volume shortcut handling)
PATCHED_MAIN = 'android-res/java/com/aiva/assistant/MainActivity.java'
if os.path.exists(PATCHED_MAIN):
    import shutil
    os.makedirs(os.path.dirname(MAIN_ACTIVITY), exist_ok=True)
    shutil.copy2(PATCHED_MAIN, MAIN_ACTIVITY)
    print('✅ Installed patched MainActivity')
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

print('✅ Android patches applied successfully')
