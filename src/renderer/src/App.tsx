import React, { useEffect, useState } from "react";
import { useAppStore } from "./store/appStore";
import MainLayout from "./components/MainLayout";
import OllamaSetup from "./components/OllamaSetup";
import LoadingScreen from "./components/LoadingScreen";

export default function App() {
  const { ollamaStatus, setOllamaStatus, loadBots, loadConfig } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    async function init() {
      await loadConfig();
      await loadBots();

      const status = await window.electronAPI.ollama.check();
      setOllamaStatus(status);

      if (!status.installed || !status.running) {
        setNeedsSetup(true);
      }

      setLoading(false);
    }
    init();

    const unsubs = [
      window.electronAPI.on("bot:created", (d) => useAppStore.getState().onBotCreated(d)),
      window.electronAPI.on("bot:deleted", (d) => useAppStore.getState().onBotDeleted(d)),
      window.electronAPI.on("bot:statusChanged", (d) => useAppStore.getState().onBotStatusChanged(d)),
      window.electronAPI.on("bot:statsUpdated", (d) => useAppStore.getState().onBotStatsUpdated(d)),
      window.electronAPI.on("bot:chat", (d) => useAppStore.getState().onBotChat(d)),
      window.electronAPI.on("bot:serverMessage", (d) => useAppStore.getState().onBotServerMessage(d)),
      window.electronAPI.on("bot:aiMessage", (d) => useAppStore.getState().onBotAiMessage(d)),
      window.electronAPI.on("bot:death", (d) => useAppStore.getState().onBotDeath(d)),
      window.electronAPI.on("bot:error", (d) => useAppStore.getState().onBotError(d)),
      window.electronAPI.on("bot:inventoryUpdated", (d) => useAppStore.getState().onInventoryUpdated(d)),
      window.electronAPI.on("bot:survivorLog", (d) => useAppStore.getState().onSurvivorLog(d)),
      window.electronAPI.on("bot:survivorStarted", (d) => useAppStore.getState().onSurvivorStarted(d)),
      window.electronAPI.on("bot:survivorStopped", (d) => useAppStore.getState().onSurvivorStopped(d)),
      window.electronAPI.on("bot:aiToggled", (d) => useAppStore.getState().onAiToggled(d)),
      window.electronAPI.on("ollama:pullProgress", (d) => useAppStore.getState().onPullProgress(d)),
      window.electronAPI.on("coordinator:groupChat", (d) => useAppStore.getState().onGroupChat(d)),
    ];

    return () => unsubs.forEach((u) => u?.());
  }, []);

  if (loading) return <LoadingScreen />;
  if (needsSetup && !ollamaStatus?.running) {
    return <OllamaSetup onComplete={() => setNeedsSetup(false)} />;
  }

  return <MainLayout />;
}
