package com.capacitorjs.plugins.localnotifications;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * BroadcastReceiver for AIVA notification action buttons.
 * Handles "done" action without launching the WebView.
 */
public class AivaNotificationReceiver extends BroadcastReceiver {
    private static final String TAG = "AivaNotifReceiver";
    private static final String PREFS_NAME = "AivaNotificationActions";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getStringExtra("actionId");
        int taskId = intent.getIntExtra("taskId", -1);

        Log.d(TAG, "Action: " + action + ", taskId: " + taskId);

        if ("done".equals(action) && taskId > 0) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putString("pending_action", "mark_done")
                .putInt("pending_task_id", taskId)
                .putLong("pending_timestamp", System.currentTimeMillis())
                .apply();
            Log.d(TAG, "Saved pending done action for task " + taskId);
        }
    }
}
