import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { useUpdater } from "@/hooks/use-updater";

function App() {
  const { state: updateState, install, relaunchApp } = useUpdater();

  return (
    <div>
      {updateState.status === "available" && (
        <div className="update-banner">
          <span>tiles {updateState.version} is available</span>
          <button className="update-banner-btn" onClick={install} type="button">Install update</button>
        </div>
      )}
      {updateState.status === "downloading" && (
        <div className="update-banner">
          <span>Downloading… {updateState.progress}%</span>
          <div className="update-progress-bar"><div className="update-progress-fill" style={{ width: `${updateState.progress}%` }} /></div>
        </div>
      )}
      {updateState.status === "ready" && (
        <div className="update-banner update-banner--ready">
          <span>Update ready</span>
          <button className="update-banner-btn" onClick={relaunchApp} type="button">Relaunch</button>
        </div>
      )}
      {updateState.status === "error" && (
        <div className="update-banner update-banner--error">
          <span>Update check failed: {updateState.message}</span>
        </div>
      )}
      <AppShell />
      <Toaster />
    </div>
  );
}

export default App;
