package com.capacitorjs.plugins.localnotifications;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * BroadcastReceiver for AIVA notification action buttons.
 * Writes pending actions to Capacitor Preferences storage for JS to process.
 */
public class AivaNotificationReceiver extends BroadcastReceiver {
    private static final String TAG = "AivaNotifReceiver";
    private static final String PREFS_NAME = "CapacitorStorage";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getStringExtra("actionId");
        int taskId = intent.getIntExtra("taskId", -1);

        Log.d(TAG, "Action: " + action + ", taskId: " + taskId);

        if ("done".equals(action) && taskId > 0) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putString("pending_action", "mark_done")
                .putString("pending_task_id", String.valueOf(taskId))
                .putString("pending_timestamp", String.valueOf(System.currentTimeMillis()))
                .apply();
            Log.d(TAG, "Saved pending done action for task " + taskId);
        }
    }
}
