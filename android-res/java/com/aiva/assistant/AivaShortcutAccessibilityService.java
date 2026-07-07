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
        AivaVolumeKeyHandler.getInstance().reloadFromPrefs(this);
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (AivaVolumeKeyHandler.getInstance().handleKeyEvent(this, event.getKeyCode(), event)) {
            AivaShortcutLauncher.launchListening(this);
            return true;
        }
        return super.onKeyEvent(event);
    }
}
