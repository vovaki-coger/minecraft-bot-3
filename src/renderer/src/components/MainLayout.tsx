import React from "react";
import { useAppStore } from "../store/appStore";
import LeftPanel from "./panels/LeftPanel";
import CenterPanel from "./panels/CenterPanel";
import RightPanel from "./panels/RightPanel";
import BotTabs from "./BotTabs";
import TopBar from "./TopBar";

export default function MainLayout() {
  const { bots, selectedBotId } = useAppStore();
  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;

  return (
    <div className="flex flex-col w-full h-full" style={{ background: "#1a1a1a" }}>
      <TopBar />
      <BotTabs />
      <div className="flex flex-1 gap-1 overflow-hidden p-1">
        <LeftPanel />
        <CenterPanel bot={selectedBot} />
        <RightPanel bot={selectedBot} />
      </div>
    </div>
  );
}
