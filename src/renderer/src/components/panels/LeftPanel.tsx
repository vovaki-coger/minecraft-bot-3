import React from "react";
import { useAppStore } from "../../store/appStore";
import AIPanel from "../tabs/AIPanel";
import ModelsTab from "../tabs/ModelsTab";
import SettingsTab from "../tabs/SettingsTab";
import CoordinatorTab from "../tabs/CoordinatorTab";

export default function LeftPanel() {
  const { activeTab } = useAppStore();

  const content = () => {
    switch (activeTab) {
      case "models": return <ModelsTab />;
      case "settings": return <SettingsTab />;
      case "coordinator": return <CoordinatorTab />;
      default: return <AIPanel />;
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
