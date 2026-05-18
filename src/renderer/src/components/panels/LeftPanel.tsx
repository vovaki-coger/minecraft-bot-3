import React from "react";
import { useAppStore } from "../../store/appStore";
import BotControls from "../BotControls";
import ModelsTab from "../tabs/ModelsTab";
import SettingsTab from "../tabs/SettingsTab";
import CoordinatorTab from "../tabs/CoordinatorTab";
import AnarchyTab from "../tabs/AnarchyTab";

export default function LeftPanel() {
  const { activeTab, bots, selectedBotId } = useAppStore();
  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;

  const content = () => {
    switch (activeTab) {
      case "models":      return <ModelsTab />;
      case "settings":    return <SettingsTab />;
      case "coordinator": return <CoordinatorTab />;
      case "anarchy":     return <AnarchyTab />;
      default:
        return (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-3 py-2 border-b text-xs font-mono" style={{ borderColor: "#3a3a3a", color: "#7ecc49" }}>
              Управление ботом
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {selectedBot ? (
                <>
                  <div className="panel p-2 mb-2">
                    <div className="text-xs mb-1" style={{ color: "#888" }}>Активный бот</div>
                    <div className="text-sm font-mono" style={{ color: "#7ecc49" }}>{selectedBot.config.nick}</div>
                    <div className="text-xs mt-0.5" style={{ color: "#555" }}>
                      {selectedBot.config.host}:{selectedBot.config.port} · {selectedBot.config.version}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "#555" }}>
                      Модель ИИ: {selectedBot.config.aiModel}
                    </div>
                  </div>
                  <BotControls bot={selectedBot} />
                </>
              ) : (
                <div className="text-xs text-center mt-8" style={{ color: "#555" }}>
                  Создайте или выберите бота
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div
      className="panel flex-shrink-0"
      style={{ width: 290, overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      {content()}
    </div>
  );
}
