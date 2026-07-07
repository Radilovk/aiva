package com.aiva.assistant;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.KeyEvent;

/**
 * Detects repeated hardware key presses for the KAYA listening shortcut.
 */
public class AivaVolumeKeyHandler {

    public interface TriggerListener {
        void onShortcutTriggered(Context context);
    }

    private static final AivaVolumeKeyHandler INSTANCE = new AivaVolumeKeyHandler();
    private static final String PREFS = "aiva_shortcut_prefs";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_BUTTON = "button";
    private static final String KEY_PRESS_COUNT = "press_count";

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

    public void reloadFromPrefs(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        configure(
            prefs.getBoolean(KEY_ENABLED, false),
            prefs.getString(KEY_BUTTON, "volume_up"),
            prefs.getInt(KEY_PRESS_COUNT, 3)
        );
    }

    public void reset() {
        currentCount = 0;
        lastPressTime = 0;
    }

    private boolean matchesButton(int keyCode, String button) {
        if ("volume_down".equals(button)) {
            return keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
        }
        return keyCode == KeyEvent.KEYCODE_VOLUME_UP;
    }

    public boolean handleKeyEvent(Context context, int keyCode, KeyEvent event) {
        reloadFromPrefs(context);
        if (!enabled || event == null || event.getAction() != KeyEvent.ACTION_DOWN) {
            return false;
        }

        if (!matchesButton(keyCode, button)) {
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
