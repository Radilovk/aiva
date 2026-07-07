package com.kaya.assistant;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KayaShortcut")
public class KayaShortcutPlugin extends Plugin {

    private static final String PREFS = "kaya_shortcut_prefs";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_BUTTON = "button";
    private static final String KEY_PRESS_COUNT = "press_count";
    private static final String KEY_BACKGROUND = "background_mode";

    @Override
    public void load() {
        super.load();
        KayaVolumeKeyHandler.getInstance().setListener(KayaShortcutLauncher::launchListening);
        reloadHandlerFromPrefs();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void reloadHandlerFromPrefs() {
        SharedPreferences prefs = prefs();
        boolean enabled = prefs.getBoolean(KEY_ENABLED, false);
        String button = prefs.getString(KEY_BUTTON, "volume_up");
        int pressCount = prefs.getInt(KEY_PRESS_COUNT, 3);
        KayaVolumeKeyHandler.getInstance().configure(enabled, button, pressCount);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        String button = call.getString("button", "volume_up");
        int pressCount = call.getInt("pressCount", 3);
        boolean backgroundMode = call.getBoolean("backgroundMode", false);

        prefs().edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_BUTTON, button)
            .putInt(KEY_PRESS_COUNT, pressCount)
            .putBoolean(KEY_BACKGROUND, backgroundMode)
            .apply();

        reloadHandlerFromPrefs();

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingLaunch(PluginCall call) {
        JSObject result = new JSObject();
        result.put("pending", KayaShortcutLauncher.consumePendingLaunch(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingLaunch(PluginCall call) {
        KayaShortcutLauncher.clearPendingLaunch(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        KayaShortcutLauncher.openAccessibilitySettings(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", KayaShortcutLauncher.isAccessibilityServiceEnabled(getContext()));
        call.resolve(result);
    }

    public void notifyShortcutTriggered() {
        notifyListeners("shortcutTriggered", new JSObject());
    }
}
