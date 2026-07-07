package com.aiva.assistant;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

/**
 * Launches the app and signals JS to start listening mode.
 */
public class AivaShortcutLauncher {

    private static final String PREFS = "aiva_shortcut_prefs";
    private static final String KEY_PENDING = "pending_listen";

    public static void launchListening(Context context) {
        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_PENDING, true).apply();

        wakeDevice(appContext);

        Intent intent = new Intent(appContext, MainActivity.class);
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );
        intent.putExtra("startListening", true);
        appContext.startActivity(intent);
    }

    private static void wakeDevice(Context context) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "kaya:shortcut"
            );
            wakeLock.acquire(8000);
        } catch (Exception ignored) {
            // best-effort wake
        }
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
        String serviceId = context.getPackageName() + "/" + AivaShortcutAccessibilityService.class.getName();
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
