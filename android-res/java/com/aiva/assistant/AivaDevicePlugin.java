package com.aiva.assistant;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.TimeZone;

/**
 * Detects the phone maker and exposes the OEM-specific switches that keep
 * KASY working when the app is closed: battery-optimization exemption and
 * the vendor auto-start / background-launch screens. Heavily customized
 * Android builds (MIUI, EMUI, ColorOS, FuntouchOS, ...) kill background
 * apps by default, which silently breaks reminders and the volume shortcut.
 */
@CapacitorPlugin(name = "AivaDevice")
public class AivaDevicePlugin extends Plugin {

    private String detectProfile() {
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase();
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) return "xiaomi";
        if (m.contains("huawei") || m.contains("honor")) return "huawei";
        if (m.contains("oppo") || m.contains("realme")) return "oppo";
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo";
        if (m.contains("oneplus")) return "oneplus";
        if (m.contains("samsung")) return "samsung";
        if (m.contains("meizu")) return "meizu";
        if (m.contains("asus")) return "asus";
        if (m.contains("letv") || m.contains("leeco")) return "letv";
        return "stock";
    }

    private boolean needsAutostart(String profile) {
        switch (profile) {
            case "xiaomi":
            case "huawei":
            case "oppo":
            case "vivo":
            case "oneplus":
            case "meizu":
            case "asus":
            case "letv":
                return true;
            default:
                return false;
        }
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true; // pre-Doze
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        String profile = detectProfile();
        Context ctx = getContext();
        JSObject result = new JSObject();
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("brand", Build.BRAND);
        result.put("model", Build.MODEL);
        result.put("device", Build.DEVICE);
        result.put("product", Build.PRODUCT);
        result.put("hardware", Build.HARDWARE);
        result.put("androidVersion", Build.VERSION.RELEASE);
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("profile", profile);
        result.put("needsAutostart", needsAutostart(profile));
        result.put("batteryOptimizationIgnored", isIgnoringBatteryOptimizations());
        result.put("timezone", TimeZone.getDefault().getID());
        result.put("locale", Locale.getDefault().toLanguageTag());
        result.put("language", Locale.getDefault().getLanguage());
        result.put("country", Locale.getDefault().getCountry());
        try {
            android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
            result.put("screenWidthPx", dm.widthPixels);
            result.put("screenHeightPx", dm.heightPixels);
            result.put("densityDpi", dm.densityDpi);
        } catch (Exception ignored) { /* optional */ }
        try {
            result.put("appVersion", ctx.getPackageManager()
                .getPackageInfo(ctx.getPackageName(), 0).versionName);
        } catch (Exception ignored) { /* optional */ }
        call.resolve(result);
    }

    @PluginMethod
    public void setVoiceSessionActive(PluginCall call) {
        boolean active = call.getBoolean("active", false);
        JSObject result = new JSObject();
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            result.put("ok", false);
            call.resolve(result);
            return;
        }
        try {
            if (active) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(true);
            } else {
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
            result.put("ok", true);
            result.put("mode", am.getMode());
            result.put("speakerphone", am.isSpeakerphoneOn());
        } catch (Exception e) {
            result.put("ok", false);
            result.put("error", e.getMessage());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        JSObject result = new JSObject();
        if (isIgnoringBatteryOptimizations()) {
            result.put("ignored", true);
            result.put("requested", false);
            call.resolve(result);
            return;
        }

        result.put("ignored", false);
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("requested", true);
        } catch (Exception e) {
            // Some OEMs block the direct dialog — fall back to the list screen
            try {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                result.put("requested", true);
            } catch (Exception ignored) {
                result.put("requested", false);
            }
        }
        call.resolve(result);
    }

    // Known OEM screens that control app auto-start / background launch.
    // Tried in order; the first one that resolves on this phone opens.
    private static final String[][] AUTOSTART_COMPONENTS = {
        {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
        {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
        {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
        {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
        {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
        {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
        {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
        {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"},
        {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
        {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
        {"com.meizu.safe", "com.meizu.safe.security.SHOW_APPSEC"},
        {"com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"},
        {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},
    };

    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        JSObject result = new JSObject();
        for (String[] component : AUTOSTART_COMPONENTS) {
            try {
                Intent intent = new Intent();
                intent.setComponent(new ComponentName(component[0], component[1]));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                result.put("opened", "oem");
                call.resolve(result);
                return;
            } catch (Exception ignored) {
                // not this OEM — try the next screen
            }
        }

        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("opened", "app_details");
        } catch (Exception e) {
            result.put("opened", "none");
        }
        call.resolve(result);
    }
}
