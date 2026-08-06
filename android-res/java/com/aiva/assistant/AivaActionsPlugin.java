package com.aiva.assistant;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;

/**
 * OEM-aware device actions via Android intents (no UI automation).
 *
 * Tested strategy (2025–2026):
 * - Huawei/Honor (no GMS): Petal Maps deep links → geo: URI
 * - Xiaomi/MIUI/HyperOS: foreground Activity start + smsto: SENDTO for SMS
 * - Stock/Samsung: Google Maps / standard intents
 *
 * @see https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/petal-maps-application-navigation-0000001060038018
 * @see https://developer.android.com/training/package-visibility/declaring
 */
@CapacitorPlugin(
    name = "AivaActions",
    permissions = {
        @Permission(strings = { android.Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class AivaActionsPlugin extends Plugin {

    private static final String PKG_GOOGLE_MAPS = "com.google.android.apps.maps";
    private static final String PKG_PETAL_MAPS = "com.huawei.maps.app";
    private static final String PKG_WAZE = "com.waze";
    private static final String PKG_WHATSAPP = "com.whatsapp";

    private String detectOem() {
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase();
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) return "xiaomi";
        if (m.contains("huawei") || m.contains("honor")) return "huawei";
        if (m.contains("samsung")) return "samsung";
        if (m.contains("oppo") || m.contains("realme")) return "oppo";
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo";
        return "stock";
    }

    private boolean isInstalled(String packageName) {
        if (packageName == null || packageName.isEmpty()) return false;
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** Prefer Activity context — required for Settings panels on MIUI/HyperOS. */
    private LaunchResult launch(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }
            return LaunchResult.ok(null);
        } catch (ActivityNotFoundException e) {
            return LaunchResult.fail("activity_not_found");
        } catch (SecurityException e) {
            return LaunchResult.fail("security_denied");
        } catch (Exception e) {
            return LaunchResult.fail(e.getMessage() != null ? e.getMessage() : "launch_failed");
        }
    }

    private LaunchResult tryLaunch(Intent intent, String method) {
        LaunchResult result = launch(intent);
        if (result.ok) {
            result.method = method;
        }
        return result;
    }

    private void resolveOk(PluginCall call, JSObject extra) {
        JSObject result = extra != null ? extra : new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    private void resolveErr(PluginCall call, String message) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("error", message);
        call.resolve(result);
    }

    private String navMode(String mode) {
        if (mode == null) return "drive";
        String m = mode.toLowerCase();
        if ("walk".equals(m) || "walking".equals(m)) return "walk";
        if ("bicycle".equals(m) || "bike".equals(m)) return "bicycle";
        if ("bus".equals(m) || "transit".equals(m)) return "bus";
        return "drive";
    }

    @PluginMethod
    public void navigateTo(PluginCall call) {
        String destination = call.getString("destination");
        if (destination == null || destination.trim().isEmpty()) {
            resolveErr(call, "destination required");
            return;
        }
        String dest = destination.trim();
        String encoded = Uri.encode(dest);
        String mode = navMode(call.getString("mode", "drive"));
        String oem = detectOem();
        String lang = call.getString("language", "bg");

        List<IntentAttempt> attempts = new ArrayList<>();

        if ("huawei".equals(oem) || isInstalled(PKG_PETAL_MAPS)) {
            attempts.add(new IntentAttempt(
                "petal_mapapp",
                new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "mapapp://navigation?saddr=&daddr=" + encoded + "&language=" + lang + "&type=" + mode
                ))
            ));
            attempts.add(new IntentAttempt(
                "petal_route",
                new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "petalmaps://route?saddr=&daddr=" + encoded + "&type=" + mode
                ))
            ));
            if (isInstalled(PKG_PETAL_MAPS)) {
                Intent petalGeo = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded));
                petalGeo.setPackage(PKG_PETAL_MAPS);
                attempts.add(new IntentAttempt("petal_geo", petalGeo));
            }
        }

        if (isInstalled(PKG_GOOGLE_MAPS)) {
            Intent gNav = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + encoded));
            gNav.setPackage(PKG_GOOGLE_MAPS);
            attempts.add(new IntentAttempt("google_navigation", gNav));
        }

        if (isInstalled(PKG_WAZE)) {
            Intent waze = new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://waze.com/ul?q=" + encoded + "&navigate=yes"));
            waze.setPackage(PKG_WAZE);
            attempts.add(new IntentAttempt("waze", waze));
        }

        // Universal — any maps app (Petal on Huawei sideload, etc.)
        attempts.add(new IntentAttempt(
            "geo_uri",
            new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded))
        ));

        String travel = "walk".equals(mode) ? "walking" : "driving";
        attempts.add(new IntentAttempt(
            "browser_maps",
            new Intent(Intent.ACTION_VIEW, Uri.parse(
                "https://www.google.com/maps/dir/?api=1&destination=" + encoded + "&travelmode=" + travel
            ))
        ));

        for (IntentAttempt attempt : attempts) {
            LaunchResult lr = tryLaunch(attempt.intent, attempt.method);
            if (lr.ok) {
                JSObject result = new JSObject();
                result.put("method", lr.method);
                result.put("oem", oem);
                resolveOk(call, result);
                return;
            }
        }

        resolveErr(call, "no maps app available");
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        JSArray packages = call.getArray("packageNames");
        String single = call.getString("packageName");
        List<String> names = new ArrayList<>();
        if (packages != null) {
            for (int i = 0; i < packages.length(); i++) {
                try {
                    String pkg = packages.getString(i);
                    if (pkg != null && !pkg.trim().isEmpty()) names.add(pkg.trim());
                } catch (Exception ignored) { /* skip */ }
            }
        }
        if (single != null && !single.trim().isEmpty()) {
            names.add(single.trim());
        }
        if (names.isEmpty()) {
            resolveErr(call, "packageName required");
            return;
        }

        PackageManager pm = getContext().getPackageManager();
        for (String packageName : names) {
            Intent launch = pm.getLaunchIntentForPackage(packageName);
            if (launch == null) continue;
            LaunchResult lr = tryLaunch(launch, "launch_intent");
            if (lr.ok) {
                JSObject result = new JSObject();
                result.put("packageName", packageName);
                resolveOk(call, result);
                return;
            }
        }

        resolveErr(call, "app not installed: " + String.join(", ", names));
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            resolveErr(call, "url required");
            return;
        }
        String trimmed = url.trim();
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            trimmed = "https://" + trimmed;
        }
        LaunchResult lr = tryLaunch(new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed)), "browser");
        if (lr.ok) {
            resolveOk(call, new JSObject().put("url", trimmed));
        } else {
            resolveErr(call, "cannot open url");
        }
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            resolveErr(call, "text required");
            return;
        }
        String body = text.trim();
        String packageName = call.getString("packageName");

        if (packageName != null && !packageName.trim().isEmpty()) {
            String pkg = packageName.trim();
            // WhatsApp deep link fallback (works when setPackage fails on some MIUI builds)
            if (PKG_WHATSAPP.equals(pkg) || "com.whatsapp".equals(pkg)) {
                LaunchResult wa = tryLaunch(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://wa.me/?text=" + Uri.encode(body))), "whatsapp_deeplink");
                if (wa.ok) {
                    resolveOk(call, new JSObject().put("method", "whatsapp_deeplink"));
                    return;
                }
            }
            Intent targeted = new Intent(Intent.ACTION_SEND);
            targeted.setType("text/plain");
            targeted.putExtra(Intent.EXTRA_TEXT, body);
            targeted.setPackage(pkg);
            LaunchResult lr = tryLaunch(targeted, "share_targeted");
            if (lr.ok) {
                resolveOk(call, new JSObject().put("packageName", pkg));
                return;
            }
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, body);
        Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
        LaunchResult lr = tryLaunch(chooser, "share_chooser");
        if (lr.ok) {
            resolveOk(call, new JSObject().put("method", "chooser"));
        } else {
            resolveErr(call, "cannot share");
        }
    }

    @PluginMethod
    public void dialNumber(PluginCall call) {
        String phone = call.getString("phone");
        if (phone == null || phone.trim().isEmpty()) {
            resolveErr(call, "phone required");
            return;
        }
        String digits = phone.trim().replaceAll("[^+0-9*#]", "");
        LaunchResult lr = tryLaunch(
            new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + digits)),
            "dial"
        );
        if (lr.ok) {
            resolveOk(call, new JSObject().put("phone", digits));
        } else {
            resolveErr(call, "cannot open dialer");
        }
    }

    @PluginMethod
    public void composeSms(PluginCall call) {
        String phone = call.getString("phone");
        String message = call.getString("message", "");
        if (phone == null || phone.trim().isEmpty()) {
            resolveErr(call, "phone required");
            return;
        }
        String digits = phone.trim().replaceAll("[^+0-9]", "");

        // smsto: + SENDTO is most reliable on MIUI / HyperOS / stock
        Intent sendTo = new Intent(Intent.ACTION_SENDTO);
        sendTo.setData(Uri.parse("smsto:" + digits));
        sendTo.putExtra("sms_body", message != null ? message : "");
        LaunchResult lr = tryLaunch(sendTo, "smsto_sendto");
        if (lr.ok) {
            resolveOk(call, new JSObject().put("phone", digits));
            return;
        }

        Intent viewSms = new Intent(Intent.ACTION_VIEW, Uri.parse("sms:" + digits));
        viewSms.putExtra("sms_body", message != null ? message : "");
        lr = tryLaunch(viewSms, "sms_view");
        if (lr.ok) {
            resolveOk(call, new JSObject().put("phone", digits));
        } else {
            resolveErr(call, "cannot open sms app");
        }
    }

    @PluginMethod
    public void setAlarm(PluginCall call) {
        Integer hour = call.getInt("hour");
        Integer minutes = call.getInt("minutes");
        if (hour == null || minutes == null) {
            resolveErr(call, "hour and minutes required");
            return;
        }
        String message = call.getString("message", "KASY");

        Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
        intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
        intent.putExtra(AlarmClock.EXTRA_MINUTES, minutes);
        intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
        intent.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        LaunchResult lr = tryLaunch(intent, "alarm");
        if (lr.ok) {
            JSObject result = new JSObject();
            result.put("hour", hour);
            result.put("minutes", minutes);
            resolveOk(call, result);
        } else {
            resolveErr(call, "no clock app available");
        }
    }

    @PluginMethod
    public void copyToClipboard(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            resolveErr(call, "text required");
            return;
        }
        ClipboardManager clipboard = (ClipboardManager)
            getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            resolveErr(call, "clipboard unavailable");
            return;
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("kasy", text));
        resolveOk(call, new JSObject().put("length", text.length()));
    }

    @PluginMethod
    public void openSystemSettings(PluginCall call) {
        String panel = call.getString("panel", "main");
        Intent intent = buildSettingsIntent(panel.toLowerCase());

        LaunchResult lr = tryLaunch(intent, "settings_" + panel);
        if (lr.ok) {
            resolveOk(call, new JSObject().put("panel", panel));
            return;
        }

        // MIUI/Huawei sometimes block Settings.Panel — fall back to full settings page
        if (!"main".equals(panel.toLowerCase())) {
            lr = tryLaunch(buildSettingsIntent("main"), "settings_main_fallback");
            if (lr.ok) {
                JSObject result = new JSObject();
                result.put("panel", panel);
                result.put("fallback", "main");
                resolveOk(call, result);
                return;
            }
        }
        resolveErr(call, "cannot open settings");
    }

    private Intent buildSettingsIntent(String panel) {
        switch (panel) {
            case "wifi":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    return new Intent(Settings.Panel.ACTION_WIFI);
                }
                return new Intent(Settings.ACTION_WIFI_SETTINGS);
            case "bluetooth":
                // Settings.Panel has no ACTION_BLUETOOTH — only WIFI, NFC, VOLUME, INTERNET_CONNECTIVITY
                return new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            case "location":
                return new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            case "battery":
                return new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
            case "app":
            case "app_details":
                Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                app.setData(Uri.parse("package:" + getContext().getPackageName()));
                return app;
            default:
                return new Intent(Settings.ACTION_SETTINGS);
        }
    }

    @PluginMethod
    public void searchMaps(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            resolveErr(call, "query required");
            return;
        }
        String encoded = Uri.encode(query.trim());
        String oem = detectOem();

        List<IntentAttempt> attempts = new ArrayList<>();
        if ("huawei".equals(oem) || isInstalled(PKG_PETAL_MAPS)) {
            Intent petal = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded));
            petal.setPackage(PKG_PETAL_MAPS);
            attempts.add(new IntentAttempt("petal_search", petal));
        }
        if (isInstalled(PKG_GOOGLE_MAPS)) {
            Intent maps = new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://www.google.com/maps/search/?api=1&query=" + encoded));
            maps.setPackage(PKG_GOOGLE_MAPS);
            attempts.add(new IntentAttempt("google_maps_search", maps));
        }
        attempts.add(new IntentAttempt("geo_search",
            new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded))));
        attempts.add(new IntentAttempt("browser_search", new Intent(Intent.ACTION_VIEW,
            Uri.parse("https://www.google.com/maps/search/?api=1&query=" + encoded))));

        for (IntentAttempt attempt : attempts) {
            LaunchResult lr = tryLaunch(attempt.intent, attempt.method);
            if (lr.ok) {
                resolveOk(call, new JSObject().put("method", lr.method));
                return;
            }
        }
        resolveErr(call, "cannot search maps");
    }

    @PluginMethod
    public void findContacts(PluginCall call) {
        if (!hasContactsPermission()) {
            requestPermissionForAlias("contacts", call, "contactsPermsCallback");
            return;
        }
        findContactsInternal(call);
    }

    @PermissionCallback
    private void contactsPermsCallback(PluginCall call) {
        if (hasContactsPermission()) {
            findContactsInternal(call);
        } else {
            resolveErr(call, "contacts permission denied");
        }
    }

    private boolean hasContactsPermission() {
        return getPermissionState("contacts").toString().equals("granted");
    }

    private void findContactsInternal(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            resolveErr(call, "query required");
            return;
        }
        String q = query.trim().toLowerCase();
        int limit = call.getInt("limit", 5);

        JSArray results = new JSArray();
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
        };

        try (Cursor cursor = getContext().getContentResolver().query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
        )) {
            if (cursor != null) {
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int phoneIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                int idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);

                while (cursor.moveToNext() && results.length() < limit) {
                    String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    if (name == null || !name.toLowerCase().contains(q)) continue;

                    JSObject row = new JSObject();
                    row.put("name", name);
                    row.put("phone", phoneIdx >= 0 ? cursor.getString(phoneIdx) : "");
                    row.put("contactId", idIdx >= 0 ? cursor.getString(idIdx) : "");
                    results.put(row);
                }
            }
        } catch (Exception e) {
            resolveErr(call, e.getMessage());
            return;
        }

        JSObject result = new JSObject();
        result.put("contacts", results);
        result.put("count", results.length());
        resolveOk(call, result);
    }

    @PluginMethod
    public void listAvailableApps(PluginCall call) {
        String[] known = {
            "com.viber.voip", PKG_WHATSAPP, "org.telegram.messenger",
            "com.google.android.gm", PKG_GOOGLE_MAPS, PKG_WAZE,
            "com.android.chrome", "com.android.camera2", "com.android.camera",
            PKG_PETAL_MAPS, "com.miui.securitycenter", "com.huawei.browser",
            "com.mi.globalbrowser", "com.sec.android.app.clockpackage",
        };
        JSArray apps = new JSArray();
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : known) {
            if (!isInstalled(pkg)) continue;
            try {
                JSObject row = new JSObject();
                row.put("packageName", pkg);
                row.put("label", pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString());
                apps.put(row);
            } catch (Exception ignored) { /* skip */ }
        }
        JSObject result = new JSObject();
        result.put("apps", apps);
        result.put("oem", detectOem());
        resolveOk(call, result);
    }

    @PluginMethod
    public void canShareWith(PluginCall call) {
        String packageName = call.getString("packageName");
        if (packageName == null || packageName.trim().isEmpty()) {
            resolveErr(call, "packageName required");
            return;
        }
        Intent probe = new Intent(Intent.ACTION_SEND);
        probe.setType("text/plain");
        probe.setPackage(packageName.trim());
        List<ResolveInfo> handlers = getContext().getPackageManager()
            .queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY);
        JSObject result = new JSObject();
        result.put("available", handlers != null && !handlers.isEmpty());
        result.put("installed", isInstalled(packageName.trim()));
        resolveOk(call, result);
    }

    /** Self-test: which handlers are installed / launchable on this device. */
    @PluginMethod
    public void runDiagnostics(PluginCall call) {
        JSObject out = new JSObject();
        out.put("oem", detectOem());
        out.put("manufacturer", Build.MANUFACTURER);
        out.put("brand", Build.BRAND);
        out.put("sdkInt", Build.VERSION.SDK_INT);

        JSArray checks = new JSArray();
        checks.put(diag("google_maps", isInstalled(PKG_GOOGLE_MAPS)));
        checks.put(diag("petal_maps", isInstalled(PKG_PETAL_MAPS)));
        checks.put(diag("waze", isInstalled(PKG_WAZE)));
        checks.put(diag("viber", isInstalled("com.viber.voip")));
        checks.put(diag("whatsapp", isInstalled(PKG_WHATSAPP)));
        checks.put(diag("telegram", isInstalled("org.telegram.messenger")));
        checks.put(diag("contacts_permission", hasContactsPermission()));

        // Dry-run launch probes (don't actually open — check resolve where possible)
        checks.put(diagLaunch("geo_uri", new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=test"))));
        checks.put(diagLaunch("tel_dial", new Intent(Intent.ACTION_DIAL, Uri.parse("tel:123"))));
        checks.put(diagLaunch("smsto", new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:123"))));
        checks.put(diagLaunch("alarm", new Intent(AlarmClock.ACTION_SET_ALARM)));

        out.put("checks", checks);
        out.put("ok", true);
        call.resolve(out);
    }

    private JSObject diag(String name, boolean value) {
        JSObject row = new JSObject();
        row.put("name", name);
        row.put("ok", value);
        return row;
    }

    private JSObject diagLaunch(String name, Intent intent) {
        JSObject row = new JSObject();
        row.put("name", name);
        try {
            Activity activity = getActivity();
            Context ctx = activity != null ? activity : getContext();
            boolean can = intent.resolveActivity(ctx.getPackageManager()) != null;
            row.put("ok", can);
            row.put("resolvable", can);
        } catch (Exception e) {
            row.put("ok", false);
            row.put("error", e.getMessage());
        }
        return row;
    }

    private static final class IntentAttempt {
        final String method;
        final Intent intent;

        IntentAttempt(String method, Intent intent) {
            this.method = method;
            this.intent = intent;
        }
    }

    private static final class LaunchResult {
        final boolean ok;
        final String error;
        String method;

        private LaunchResult(boolean ok, String error) {
            this.ok = ok;
            this.error = error;
        }

        static LaunchResult ok(String method) {
            LaunchResult r = new LaunchResult(true, null);
            r.method = method;
            return r;
        }

        static LaunchResult fail(String error) {
            return new LaunchResult(false, error);
        }
    }
}
