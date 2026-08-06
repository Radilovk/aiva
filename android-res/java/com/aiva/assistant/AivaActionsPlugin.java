package com.aiva.assistant;

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

import java.util.List;

/**
 * Reliable Android device actions via system intents (no UI automation).
 * Works across stock Android, Xiaomi, Huawei, Samsung, etc. — with graceful
 * fallbacks when Google apps are missing (e.g. Huawei → geo: URI).
 */
@CapacitorPlugin(
    name = "AivaActions",
    permissions = {
        @Permission(strings = { android.Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class AivaActionsPlugin extends Plugin {

    private boolean launch(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
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

    @PluginMethod
    public void navigateTo(PluginCall call) {
        String destination = call.getString("destination");
        if (destination == null || destination.trim().isEmpty()) {
            resolveErr(call, "destination required");
            return;
        }
        String encoded = Uri.encode(destination.trim());
        String mode = call.getString("mode", "drive");

        // 1) Google Maps navigation (best on GMS devices)
        Intent nav = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + encoded));
        nav.setPackage("com.google.android.apps.maps");
        if (launch(nav)) {
            resolveOk(call, new JSObject().put("method", "google_navigation"));
            return;
        }

        // 2) Any maps app via geo URI (Huawei Petal Maps, Waze sideload, etc.)
        Intent geo = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded));
        if (launch(geo)) {
            resolveOk(call, new JSObject().put("method", "geo_uri"));
            return;
        }

        // 3) Browser fallback
        String travel = "driving".equalsIgnoreCase(mode) ? "driving" : "walking";
        Intent browser = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + encoded + "&travelmode=" + travel)
        );
        if (launch(browser)) {
            resolveOk(call, new JSObject().put("method", "browser_maps"));
            return;
        }

        resolveErr(call, "no maps app available");
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String packageName = call.getString("packageName");
        if (packageName == null || packageName.trim().isEmpty()) {
            resolveErr(call, "packageName required");
            return;
        }
        packageName = packageName.trim();

        PackageManager pm = getContext().getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage(packageName);
        if (launch != null && launch(launch)) {
            resolveOk(call, new JSObject().put("packageName", packageName));
            return;
        }

        resolveErr(call, "app not installed: " + packageName);
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
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
        if (launch(intent)) {
            resolveOk(call, new JSObject().put("url", trimmed));
            return;
        }
        resolveErr(call, "cannot open url");
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            resolveErr(call, "text required");
            return;
        }
        String packageName = call.getString("packageName");

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text.trim());
        if (packageName != null && !packageName.trim().isEmpty()) {
            send.setPackage(packageName.trim());
            if (launch(send)) {
                resolveOk(call, new JSObject().put("packageName", packageName.trim()));
                return;
            }
        }

        Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
        if (launch(chooser)) {
            resolveOk(call, new JSObject().put("method", "chooser"));
            return;
        }
        resolveErr(call, "cannot share");
    }

    @PluginMethod
    public void dialNumber(PluginCall call) {
        String phone = call.getString("phone");
        if (phone == null || phone.trim().isEmpty()) {
            resolveErr(call, "phone required");
            return;
        }
        String digits = phone.trim().replaceAll("[^+0-9*#]", "");
        Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + digits));
        if (launch(intent)) {
            resolveOk(call, new JSObject().put("phone", digits));
            return;
        }
        resolveErr(call, "cannot open dialer");
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
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("sms:" + digits));
        intent.putExtra("sms_body", message != null ? message : "");
        if (launch(intent)) {
            resolveOk(call, new JSObject().put("phone", digits));
            return;
        }
        resolveErr(call, "cannot open sms app");
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
        if (launch(intent)) {
            JSObject result = new JSObject();
            result.put("hour", hour);
            result.put("minutes", minutes);
            resolveOk(call, result);
            return;
        }
        resolveErr(call, "no clock app available");
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
        Intent intent;

        switch (panel.toLowerCase()) {
            case "wifi":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    intent = new Intent(Settings.Panel.ACTION_WIFI);
                } else {
                    intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                }
                break;
            case "bluetooth":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    intent = new Intent(Settings.Panel.ACTION_BLUETOOTH);
                } else {
                    intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                }
                break;
            case "location":
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                break;
            case "battery":
                intent = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
                break;
            case "app":
            case "app_details":
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                break;
            default:
                intent = new Intent(Settings.ACTION_SETTINGS);
                break;
        }

        if (launch(intent)) {
            resolveOk(call, new JSObject().put("panel", panel));
            return;
        }
        resolveErr(call, "cannot open settings");
    }

    @PluginMethod
    public void searchMaps(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            resolveErr(call, "query required");
            return;
        }
        String encoded = Uri.encode(query.trim());

        Intent maps = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.google.com/maps/search/?api=1&query=" + encoded)
        );
        maps.setPackage("com.google.android.apps.maps");
        if (launch(maps)) {
            resolveOk(call, new JSObject().put("method", "google_maps_search"));
            return;
        }

        Intent geo = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded));
        if (launch(geo)) {
            resolveOk(call, new JSObject().put("method", "geo_search"));
            return;
        }

        Intent browser = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.google.com/maps/search/?api=1&query=" + encoded)
        );
        if (launch(browser)) {
            resolveOk(call, new JSObject().put("method", "browser_search"));
            return;
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
        JSArray apps = new JSArray();
        String[] known = {
            "com.viber.voip", "com.whatsapp", "org.telegram.messenger",
            "com.google.android.gm", "com.google.android.apps.maps",
            "com.waze", "com.android.chrome", "com.android.camera2",
            "com.huawei.maps.app", "com.huawei.android.launcher",
        };
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : known) {
            try {
                pm.getPackageInfo(pkg, 0);
                JSObject row = new JSObject();
                row.put("packageName", pkg);
                row.put("label", pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString());
                apps.put(row);
            } catch (PackageManager.NameNotFoundException ignored) {
                // not installed
            }
        }
        JSObject result = new JSObject();
        result.put("apps", apps);
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
        resolveOk(call, result);
    }
}
