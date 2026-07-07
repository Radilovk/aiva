package com.kaya.assistant;

import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Optional background listener for volume-button shortcuts when the app is not in foreground.
 * User must enable this service in Android Accessibility settings.
 */
public class KayaShortcutAccessibilityService extends AccessibilityService {

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Key events only — no node processing needed.
    }

    @Override
    public void onInterrupt() {
        // no-op
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (KayaVolumeKeyHandler.getInstance().handleKeyEvent(this, event.getKeyCode(), event)) {
            KayaShortcutLauncher.launchListening(this);
            return true;
        }
        return super.onKeyEvent(event);
    }
}
