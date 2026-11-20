package org.benchflow.companion;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.ProcessedRoute;
import java.io.File;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Notebook text links attachments as /uploads/<name> (as on the desktop). Serve those from the
        // app's own attachments folder (mobile/src/device.ts), so text and photos show unchanged and offline.
        bridgeBuilder.setRouteProcessor((basePath, path) -> {
            ProcessedRoute route = new ProcessedRoute();
            if (path.startsWith("/uploads/") && !path.contains("..")) {
                route.setPath(new File(new File(getFilesDir(), "attachments"), path.substring("/uploads/".length())).getAbsolutePath());
                route.setAsset(false);
            } else {
                route.setPath(basePath + path);
                route.setAsset(true);
            }
            return route;
        });
        super.onCreate(savedInstanceState);
    }
}
