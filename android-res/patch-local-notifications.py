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

with open(MANIFEST, 'w') as f:
    f.write(content)

# Patch MainActivity to register AivaCalendarPlugin
if os.path.exists(MAIN_ACTIVITY):
    with open(MAIN_ACTIVITY, 'r') as f:
        main = f.read()

    if 'AivaCalendarPlugin' not in main:
        if 'import com.aiva.assistant.AivaCalendarPlugin;' not in main:
            main = main.replace(
                'import com.getcapacitor.BridgeActivity;',
                'import com.getcapacitor.BridgeActivity;\nimport com.aiva.assistant.AivaCalendarPlugin;',
            )

        if 'registerPlugin(AivaCalendarPlugin.class)' not in main:
            # Capacitor 8 MainActivity extends BridgeActivity without onCreate override
            if 'onCreate' in main:
                main = re.sub(
                    r'(super\.onCreate\(savedInstanceState\);)',
                    r'registerPlugin(AivaCalendarPlugin.class);\n        \1',
                    main,
                    count=1,
                )
            else:
                main = main.replace(
                    'public class MainActivity extends BridgeActivity {}',
                    '''public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(AivaCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}''',
                )

        with open(MAIN_ACTIVITY, 'w') as f:
            f.write(main)
        print('✅ Registered AivaCalendarPlugin in MainActivity')
else:
    print(f'⚠ MainActivity not found at {MAIN_ACTIVITY} — plugin registration skipped')

print('✅ Android patches applied successfully')
