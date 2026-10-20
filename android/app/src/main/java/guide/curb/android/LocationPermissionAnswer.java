package guide.curb.android;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.RemoteException;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.trusted.TrustedWebActivityCallbackRemote;

import com.google.androidbrowserhelper.trusted.ExtraCommandHandler;

/**
 * Answers Chrome's location permission check with the app's own permission, at once. The library's handler shows the
 * Android prompt from this background service instead, which Android 10 and later block without a word, so a location
 * request on the page waited forever. LauncherActivity asks at launch.
 */
class LocationPermissionAnswer implements ExtraCommandHandler {
    private static final String CHECK = "checkAndroidLocationPermission";

    @NonNull
    @Override
    public Bundle handleExtraCommand(Context context, String commandName, Bundle args,
            @Nullable TrustedWebActivityCallbackRemote callback) {
        boolean mine = CHECK.equals(commandName) && callback != null;
        Bundle result = new Bundle();
        result.putBoolean(EXTRA_COMMAND_SUCCESS, mine);  // anything else goes on to the library's handler
        if (mine) {
            Bundle answer = new Bundle();
            answer.putBoolean("locationPermissionResult", LauncherActivity.hasLocation(context));
            // after this call returns, as the library's answer comes
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    callback.runExtraCallback(CHECK, answer);
                } catch (RemoteException e) {
                    // Chrome went away: it asks again with its next location request
                }
            });
        }
        return result;
    }
}
