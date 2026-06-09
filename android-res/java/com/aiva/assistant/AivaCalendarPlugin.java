package com.aiva.assistant;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.TimeZone;

/**
 * Native Android calendar integration via CalendarContract.
 * Inserts/updates/removes AIVA tasks as calendar events with reminders.
 */
@CapacitorPlugin(
    name = "AivaCalendar",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CALENDAR }, alias = "calendar"),
        @Permission(strings = { Manifest.permission.WRITE_CALENDAR }, alias = "calendar")
    }
)
public class AivaCalendarPlugin extends Plugin {

    private static final String TAG = "AivaCalendar";

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("calendar") == com.getcapacitor.PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("calendar", "granted");
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("calendar", call, "calendarPermsCallback");
    }

    @PermissionCallback
    private void calendarPermsCallback(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = getPermissionState("calendar") == com.getcapacitor.PermissionState.GRANTED;
        result.put("calendar", granted ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod
    public void addEvent(PluginCall call) {
        if (!ensureCalendarPermission(call)) return;

        String title = call.getString("title", "AIVA задача");
        String description = call.getString("description", "");
        String location = call.getString("location", "");
        long startTime = call.getLong("startTime", 0L);
        long endTime = call.getLong("endTime", startTime + 1800000L);
        int reminderMinutes = call.getInt("reminderMinutes", 15);
        boolean remindAtStart = call.getBoolean("remindAtStart", true);
        int taskId = call.getInt("taskId", 0);

        if (startTime <= 0) {
            call.reject("startTime е задължителен");
            return;
        }

        try {
            long calendarId = getDefaultCalendarId();
            if (calendarId < 0) {
                call.reject("Няма наличен календар на устройството");
                return;
            }

            ContentValues event = new ContentValues();
            event.put(CalendarContract.Events.CALENDAR_ID, calendarId);
            event.put(CalendarContract.Events.TITLE, title);
            event.put(CalendarContract.Events.DESCRIPTION, description);
            event.put(CalendarContract.Events.EVENT_LOCATION, location);
            event.put(CalendarContract.Events.DTSTART, startTime);
            event.put(CalendarContract.Events.DTEND, endTime);
            event.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            event.put(CalendarContract.Events.HAS_ALARM, 1);
            event.put(CalendarContract.Events.CUSTOM_APP_PACKAGE, getContext().getPackageName());

            Uri uri = getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI, event);
            if (uri == null) {
                call.reject("Неуспешно добавяне в календара");
                return;
            }

            long eventId = ContentUris.parseId(uri);
            addReminders(eventId, reminderMinutes, remindAtStart);

            JSObject result = new JSObject();
            result.put("eventId", String.valueOf(eventId));
            result.put("taskId", taskId);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Грешка при добавяне: " + e.getMessage());
        }
    }

    @PluginMethod
    public void updateEvent(PluginCall call) {
        if (!ensureCalendarPermission(call)) return;

        String eventIdStr = call.getString("eventId");
        if (eventIdStr == null) {
            call.reject("eventId е задължителен");
            return;
        }

        long eventId = Long.parseLong(eventIdStr);
        String title = call.getString("title", "AIVA задача");
        String description = call.getString("description", "");
        String location = call.getString("location", "");
        long startTime = call.getLong("startTime", 0L);
        long endTime = call.getLong("endTime", startTime + 1800000L);
        int reminderMinutes = call.getInt("reminderMinutes", 15);
        boolean remindAtStart = call.getBoolean("remindAtStart", true);

        try {
            ContentValues event = new ContentValues();
            event.put(CalendarContract.Events.TITLE, title);
            event.put(CalendarContract.Events.DESCRIPTION, description);
            event.put(CalendarContract.Events.EVENT_LOCATION, location);
            event.put(CalendarContract.Events.DTSTART, startTime);
            event.put(CalendarContract.Events.DTEND, endTime);

            Uri updateUri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
            getContext().getContentResolver().update(updateUri, event, null, null);

            removeReminders(eventId);
            addReminders(eventId, reminderMinutes, remindAtStart);

            JSObject result = new JSObject();
            result.put("eventId", eventIdStr);
            result.put("updated", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Грешка при обновяване: " + e.getMessage());
        }
    }

    @PluginMethod
    public void removeEvent(PluginCall call) {
        if (!ensureCalendarPermission(call)) return;

        String eventIdStr = call.getString("eventId");
        if (eventIdStr == null) {
            call.reject("eventId е задължителен");
            return;
        }

        try {
            long eventId = Long.parseLong(eventIdStr);
            removeReminders(eventId);
            Uri deleteUri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
            getContext().getContentResolver().delete(deleteUri, null, null);

            JSObject result = new JSObject();
            result.put("removed", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Грешка при изтриване: " + e.getMessage());
        }
    }

    private boolean ensureCalendarPermission(PluginCall call) {
        if (getPermissionState("calendar") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Няма разрешение за календар");
            return false;
        }
        return true;
    }

    private long getDefaultCalendarId() {
        ContentResolver cr = getContext().getContentResolver();
        String[] projection = new String[]{
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY
        };

        Uri uri = CalendarContract.Calendars.CONTENT_URI;
        android.database.Cursor cursor = cr.query(uri, projection, null, null, null);

        long primaryId = -1;
        long firstId = -1;

        if (cursor != null) {
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                int isPrimary = cursor.getInt(1);
                if (firstId < 0) firstId = id;
                if (isPrimary == 1) {
                    primaryId = id;
                    break;
                }
            }
            cursor.close();
        }

        return primaryId >= 0 ? primaryId : firstId;
    }

    private void addReminders(long eventId, int reminderMinutes, boolean remindAtStart) {
        ContentResolver cr = getContext().getContentResolver();

        if (reminderMinutes > 0) {
            ContentValues reminder = new ContentValues();
            reminder.put(CalendarContract.Reminders.EVENT_ID, eventId);
            reminder.put(CalendarContract.Reminders.MINUTES, reminderMinutes);
            reminder.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
            cr.insert(CalendarContract.Reminders.CONTENT_URI, reminder);
        }

        if (remindAtStart) {
            ContentValues atStart = new ContentValues();
            atStart.put(CalendarContract.Reminders.EVENT_ID, eventId);
            atStart.put(CalendarContract.Reminders.MINUTES, 0);
            atStart.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
            cr.insert(CalendarContract.Reminders.CONTENT_URI, atStart);
        }
    }

    private void removeReminders(long eventId) {
        ContentResolver cr = getContext().getContentResolver();
        cr.delete(
            CalendarContract.Reminders.CONTENT_URI,
            CalendarContract.Reminders.EVENT_ID + " = ?",
            new String[]{String.valueOf(eventId)}
        );
    }
}
