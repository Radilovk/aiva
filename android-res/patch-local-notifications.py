#!/usr/bin/env python3
"""
Patch AndroidManifest.xml to add notification permissions and receivers for AIVA.
Run from repo root after `npx cap add android && npx cap sync android`.
"""
import re
import sys
import os

MANIFEST = 'android/app/src/main/AndroidManifest.xml'

if not os.path.exists(MANIFEST):
    print(f'ERROR: {MANIFEST} not found. Run `npx cap add android` first.')
    sys.exit(1)

with open(MANIFEST, 'r') as f:
    content = f.read()

# Add permissions before <application>
# RECORD_AUDIO + MODIFY_AUDIO_SETTINGS are required so that Capacitor's
# BridgeWebChromeClient.onPermissionRequest can grant getUserMedia in the WebView.
# Without them the audio capture request is denied instantly and voice
# recording/listening fails in the APK while it works on the web.
PERMISSIONS = """
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.INTERNET" />
"""

if 'POST_NOTIFICATIONS' not in content:
    content = content.replace('<application', PERMISSIONS + '\n    <application', 1)
    print('✅ Added notification + microphone permissions')

# Ensure RECORD_AUDIO is present even if the notification permissions were
# already patched in by a previous run.
if 'RECORD_AUDIO' not in content:
    content = content.replace(
        '<application',
        '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n'
        '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n'
        '    <application',
        1,
    )
    print('✅ Added microphone permissions')

# Add BroadcastReceiver before </application>
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

print('✅ AndroidManifest.xml patched successfully')
