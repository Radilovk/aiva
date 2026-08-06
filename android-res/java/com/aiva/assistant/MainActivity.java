package com.aiva.assistant;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final int BRAND_BG = Color.parseColor("#050508");
    private static final int ESSENTIAL_PERMISSIONS_REQUEST = 9001;
    private boolean pendingListenStart = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AivaCalendarPlugin.class);
        registerPlugin(AivaShortcutPlugin.class);
        registerPlugin(AivaDevicePlugin.class);
        registerPlugin(AivaActionsPlugin.class);
        super.onCreate(savedInstanceState);
        applyDarkSystemBars();
        requestEssentialPermissions();
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

    /** Prompt for mic, notifications, calendar as soon as the app opens. */
    private void requestEssentialPermissions() {
        List<String> needed = new ArrayList<>();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.MODIFY_AUDIO_SETTINGS)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALENDAR)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.READ_CALENDAR);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_CALENDAR)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.WRITE_CALENDAR);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                ESSENTIAL_PERMISSIONS_REQUEST
            );
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

        WindowCompat.setDecorFitsSystemWindows(window, true);
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
