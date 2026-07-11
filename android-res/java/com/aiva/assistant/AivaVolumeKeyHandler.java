package com.aiva.assistant;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.KeyEvent;

/**
 * Detects the KAYA listening shortcut: volume up + volume down pressed
 * together (a chord). A single simultaneous press triggers — that never
 * happens during normal volume use, where only one button is down at a
 * time. The short press also stays clear of the system accessibility
 * shortcut, which requires holding both keys for ~3 seconds.
 */
public class AivaVolumeKeyHandler {

    public interface TriggerListener {
        void onShortcutTriggered(Context context);
    }

    private static final AivaVolumeKeyHandler INSTANCE = new AivaVolumeKeyHandler();
    private static final String PREFS = "aiva_shortcut_prefs";
    private static final String KEY_ENABLED = "enabled";

    // A key counts as "held" for at most this long — protects against a
    // missed ACTION_UP (focus change etc.) leaving the state stuck.
    private static final long HOLD_EXPIRY_MS = 5000;
    private static final long RETRIGGER_COOLDOWN_MS = 1500;

    private boolean enabled = false;

    private boolean upPressed = false;
    private boolean downPressed = false;
    private long upPressedAt = 0;
    private long downPressedAt = 0;
    private boolean chordFired = false;
    private long lastTriggerTime = 0;
    private TriggerListener listener;

    public static AivaVolumeKeyHandler getInstance() {
        return INSTANCE;
    }

    public void setListener(TriggerListener listener) {
        this.listener = listener;
    }

    public void configure(boolean enabled) {
        // Reset only on an actual state change — configure() runs on every
        // key event via reloadFromPrefs.
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
        upPressed = false;
        downPressed = false;
        upPressedAt = 0;
        downPressedAt = 0;
        chordFired = false;
    }

    private boolean isHeld(boolean pressed, long pressedAt, long now) {
        return pressed && now - pressedAt <= HOLD_EXPIRY_MS;
    }

    /**
     * Returns true only for the press that completes the chord (the launch
     * happens through the TriggerListener) and for auto-repeats after a
     * fired chord, so holding both keys doesn't ramp the volume. All other
     * presses pass through and volume control keeps working.
     */
    public boolean handleKeyEvent(Context context, int keyCode, KeyEvent event) {
        reloadFromPrefs(context);
        if (!enabled || event == null) {
            return false;
        }

        boolean isUp = keyCode == KeyEvent.KEYCODE_VOLUME_UP;
        boolean isDown = keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
        if (!isUp && !isDown) {
            return false;
        }

        int action = event.getAction();
        long now = System.currentTimeMillis();

        if (action == KeyEvent.ACTION_UP) {
            if (isUp) upPressed = false;
            if (isDown) downPressed = false;
            if (!upPressed && !downPressed) {
                boolean consumed = chordFired;
                chordFired = false;
                return consumed; // swallow the releases of a fired chord
            }
            return chordFired;
        }

        if (action != KeyEvent.ACTION_DOWN) {
            return false;
        }

        if (event.getRepeatCount() != 0) {
            // Holding: don't retrigger; consume repeats after a fired chord.
            return chordFired;
        }

        if (isUp) {
            upPressed = true;
            upPressedAt = now;
        } else {
            downPressed = true;
            downPressedAt = now;
        }

        boolean bothHeld = isHeld(upPressed, upPressedAt, now) && isHeld(downPressed, downPressedAt, now);
        if (bothHeld && !chordFired) {
            chordFired = true;
            if (now - lastTriggerTime > RETRIGGER_COOLDOWN_MS) {
                lastTriggerTime = now;
                if (listener != null) {
                    listener.onShortcutTriggered(context);
                }
            }
            return true; // consume the completing press
        }

        return false;
    }
}
