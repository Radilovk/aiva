package com.aiva.assistant;

import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int BRAND_BG = Color.parseColor("#050508");
    private boolean pendingListenStart = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AivaCalendarPlugin.class);
        registerPlugin(AivaShortcutPlugin.class);
        registerPlugin(AivaDevicePlugin.class);
        super.onCreate(savedInstanceState);
        applyDarkSystemBars();
        AivaVolumeKeyHandler.getInstance().setListener(AivaShortcutLauncher::launchListening);
        handleLaunchIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        applyDarkSystemBars();
        if (pendingListenStart) {
            pendingListenStart = false;
            notifyShortcutToJs();
        }
    }

    private void applyDarkSystemBars() {
        Window window = getWindow();
        if (window == null) return;

        window.setStatusBarColor(BRAND_BG);
        window.setNavigationBarColor(BRAND_BG);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }

        WindowCompat.setDecorFitsSystemWindows(window, false);
        View decor = window.getDecorView();
        decor.setBackgroundColor(BRAND_BG);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }
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
        dismissKeyguard();
        intent.removeExtra("startListening");
        pendingListenStart = true;
    }

    private void wakeScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );
    }

    private void dismissKeyguard() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (keyguardManager != null && keyguardManager.isKeyguardLocked()) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (AivaVolumeKeyHandler.getInstance().handleKeyEvent(this, event.getKeyCode(), event)) {
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
