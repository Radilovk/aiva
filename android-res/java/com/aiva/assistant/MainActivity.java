package com.aiva.assistant;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AivaCalendarPlugin.class);
        registerPlugin(AivaShortcutPlugin.class);
        super.onCreate(savedInstanceState);
        AivaVolumeKeyHandler.getInstance().setListener(AivaShortcutLauncher::launchListening);
        handleLaunchIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleLaunchIntent(intent);
    }

    private void handleLaunchIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("startListening", false)) {
            return;
        }
        wakeScreen();
        intent.removeExtra("startListening");
    }

    private void wakeScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (AivaVolumeKeyHandler.getInstance().handleKeyEvent(this, event.getKeyCode(), event)) {
            notifyShortcutToJs();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void notifyShortcutToJs() {
        wakeScreen();
        if (getBridge() == null) return;
        com.getcapacitor.PluginHandle handle = getBridge().getPlugin("AivaShortcut");
        if (handle != null && handle.getInstance() instanceof AivaShortcutPlugin) {
            ((AivaShortcutPlugin) handle.getInstance()).notifyShortcutTriggered();
        }
    }
}
