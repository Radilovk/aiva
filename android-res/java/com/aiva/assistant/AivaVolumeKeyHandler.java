package com.aiva.assistant;

import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;

/**
 * Detects repeated volume key presses for the AIVA hardware shortcut.
 */
public class AivaVolumeKeyHandler {

    public interface TriggerListener {
        void onShortcutTriggered(Context context);
    }

    private static final AivaVolumeKeyHandler INSTANCE = new AivaVolumeKeyHandler();

    private boolean enabled = false;
    private String button = "volume_up";
    private int pressCount = 3;
    private long windowMs = 1600;

    private int currentCount = 0;
    private long lastPressTime = 0;
    private TriggerListener listener;

    public static AivaVolumeKeyHandler getInstance() {
        return INSTANCE;
    }

    public void setListener(TriggerListener listener) {
        this.listener = listener;
    }

    public void configure(boolean enabled, String button, int pressCount) {
        this.enabled = enabled;
        this.button = button != null ? button : "volume_up";
        this.pressCount = Math.max(2, Math.min(5, pressCount));
        reset();
    }

    public void reset() {
        currentCount = 0;
        lastPressTime = 0;
    }

    private boolean matchesButton(int keyCode, String button) {
        if ("volume_up".equals(button)) {
            return keyCode == KeyEvent.KEYCODE_VOLUME_UP;
        }
        if ("volume_down".equals(button)) {
            return keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
        }
        if ("headset".equals(button)) {
            return keyCode == KeyEvent.KEYCODE_HEADSETHOOK
                || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        }
        if ("camera".equals(button)) {
            return keyCode == KeyEvent.KEYCODE_CAMERA
                || keyCode == KeyEvent.KEYCODE_FOCUS;
        }
        return false;
    }

    public boolean handleKeyEvent(Context context, int keyCode, KeyEvent event) {
        if (!enabled || event == null || event.getAction() != KeyEvent.ACTION_DOWN) {
            return false;
        }

        boolean isTarget = matchesButton(keyCode, button);
        if (!isTarget) {
            return false;
        }

        long now = System.currentTimeMillis();
        if (now - lastPressTime > windowMs) {
            currentCount = 0;
        }
        lastPressTime = now;
        currentCount++;

        if (currentCount >= pressCount) {
            currentCount = 0;
            if (listener != null) {
                listener.onShortcutTriggered(context);
            }
            return true;
        }

        return true;
    }
}
