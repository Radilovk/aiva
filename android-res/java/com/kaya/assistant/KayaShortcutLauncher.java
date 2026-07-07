package com.kaya.assistant;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.BridgeActivity;

/**
 * Launches the app and signals JS to start listening mode.
 */
public class KayaShortcutLauncher {

    private static final String PREFS = "kaya_shortcut_prefs";
    private static final String KEY_PENDING = "pending_listen";

    public static void launchListening(Context context) {
        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_PENDING, true).apply();

        Intent intent = new Intent(appContext, BridgeActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("startListening", true);
        appContext.startActivity(intent);
    }

    public static boolean consumePendingLaunch(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean pending = prefs.getBoolean(KEY_PENDING, false);
        if (pending) {
            prefs.edit().putBoolean(KEY_PENDING, false).apply();
        }
        return pending;
    }

    public static void clearPendingLaunch(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_PENDING, false)
            .apply();
    }

    public static boolean isAccessibilityServiceEnabled(Context context) {
        String serviceId = context.getPackageName() + "/" + KayaShortcutAccessibilityService.class.getCanonicalName();
        try {
            int enabled = Settings.Secure.getInt(context.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 0);
            if (enabled != 1) return false;
            String setting = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (setting == null) return false;
            return setting.contains(serviceId);
        } catch (Exception e) {
            return false;
        }
    }

    public static void openAccessibilitySettings(Context context) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
