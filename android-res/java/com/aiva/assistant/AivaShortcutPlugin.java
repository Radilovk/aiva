package com.aiva.assistant;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AivaShortcut")
public class AivaShortcutPlugin extends Plugin {

    private static final String PREFS = "aiva_shortcut_prefs";
    private static final String KEY_ENABLED = "enabled";

    @Override
    public void load() {
        super.load();
        AivaVolumeKeyHandler.getInstance().setListener(AivaShortcutLauncher::launchListening);
        AivaVolumeKeyHandler.getInstance().reloadFromPrefs(getContext());
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);

        prefs().edit()
            .putBoolean(KEY_ENABLED, enabled)
            .apply();

        AivaVolumeKeyHandler.getInstance().configure(enabled);

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingLaunch(PluginCall call) {
        JSObject result = new JSObject();
        result.put("pending", AivaShortcutLauncher.consumePendingLaunch(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingLaunch(PluginCall call) {
        AivaShortcutLauncher.clearPendingLaunch(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        AivaShortcutLauncher.openAccessibilitySettings(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", AivaShortcutLauncher.isAccessibilityServiceEnabled(getContext()));
        call.resolve(result);
    }

    public void notifyShortcutTriggered() {
        notifyListeners("shortcutTriggered", new JSObject());
    }
}
