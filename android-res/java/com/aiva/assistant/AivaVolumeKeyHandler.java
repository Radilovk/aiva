package com.aiva.assistant;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.KeyEvent;

/**
 * Detects the KAYA listening shortcut: volume up, down, up, down — four
 * alternating presses within a short window. The alternating pattern never
 * fires from normal volume use, and the volume level ends unchanged
 * (two ups + two downs cancel out), so no key press needs to be swallowed.
 */
public class AivaVolumeKeyHandler {

    public interface TriggerListener {
        void onShortcutTriggered(Context context);
    }

    private static final AivaVolumeKeyHandler INSTANCE = new AivaVolumeKeyHandler();
    private static final String PREFS = "aiva_shortcut_prefs";
    private static final String KEY_ENABLED = "enabled";

    // Expected press sequence: +, -, +, -
    private static final int[] PATTERN = {
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
    };

    private boolean enabled = false;
    private long windowMs = 1800;

    private int patternIndex = 0;
    private long lastPressTime = 0;
    private TriggerListener listener;

    public static AivaVolumeKeyHandler getInstance() {
        return INSTANCE;
    }

    public void setListener(TriggerListener listener) {
        this.listener = listener;
    }

    public void configure(boolean enabled) {
        // Reset the sequence only on an actual state change — configure()
        // runs on every key event via reloadFromPrefs.
        if (this.enabled != enabled) {
            reset();
        }
        this.enabled = enabled;
    }

    public void reloadFromPrefs(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        configure(prefs.getBoolean(KEY_ENABLED, false));
    }

    public void reset() {
        patternIndex = 0;
        lastPressTime = 0;
    }

    /**
     * Returns true only for the final press that completes the pattern —
     * the launch itself happens through the TriggerListener. Every other
     * press is left to the system so volume control keeps working.
     */
    public boolean handleKeyEvent(Context context, int keyCode, KeyEvent event) {
        reloadFromPrefs(context);
        if (!enabled || event == null || event.getAction() != KeyEvent.ACTION_DOWN) {
            return false;
        }
        if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false;
        }
        if (event.getRepeatCount() != 0) {
            // Holding a button is normal volume ramping, not part of the pattern.
            reset();
            return false;
        }

        long now = System.currentTimeMillis();
        if (now - lastPressTime > windowMs) {
            patternIndex = 0;
        }
        lastPressTime = now;

        if (keyCode == PATTERN[patternIndex]) {
            patternIndex++;
        } else {
            // Volume-up always restarts a potential sequence.
            patternIndex = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? 1 : 0;
        }

        if (patternIndex >= PATTERN.length) {
            reset();
            if (listener != null) {
                listener.onShortcutTriggered(context);
            }
            return true;
        }
        return false;
    }
}
