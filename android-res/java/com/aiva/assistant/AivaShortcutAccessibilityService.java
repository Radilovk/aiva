package com.aiva.assistant;

import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Background listener for volume-button shortcuts when the app is not in foreground.
 * User must enable this service once in Android Accessibility settings.
 */
public class AivaShortcutAccessibilityService extends AccessibilityService {

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Key events only.
    }

    @Override
    public void onInterrupt() {
        // no-op
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        // The service can run without MainActivity ever being created,
        // so it must install the launch listener itself.
        AivaVolumeKeyHandler handler = AivaVolumeKeyHandler.getInstance();
        handler.setListener(AivaShortcutLauncher::launchListening);
        handler.reloadFromPrefs(this);
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        // The launch happens via the TriggerListener when the +/− chord
        // completes; handleKeyEvent's return value only controls whether the
        // key event is consumed. Calling launchListening here on every
        // consumed press is what used to start the app after a single
        // volume-up.
        if (AivaVolumeKeyHandler.getInstance().handleKeyEvent(this, event.getKeyCode(), event)) {
            return true;
        }
        return super.onKeyEvent(event);
    }
}
