import React, { useState, useEffect, useRef } from "react";
import { useAppStore, InstalledModelInfo } from "../../store/appStore";

export default function AIPanel() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find((b) => b.id === selectedBotId);
  const [systemPrompt, setSystemPrompt] = useState(bot?.config.systemPrompt || "");
  const [saving, setSaving] = useState(false);
  const [aiMode, setAiMode] = useState<"local" | "api">(bot?.config.aiMode || "local");
  const [apiKey, setApiKey] = useState(bot?.config.apiKey || "");
  const [apiProvider, setApiProvider] = useState(bot?.config.apiProvider || "openai");
  const [model, setModel] = useState(bot?.config.aiModel || "sweaterdog/andy-4:micro-q8_0");

  const [installedModels, setInstalledModels] = useState<InstalledModelInfo[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadInstalledModels();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadInstalledModels() {
    setLoadingModels(true);
    try {
      const result = await window.electronAPI.ollama.listInstalledModels();
      setInstalledModels(result);
    } catch {
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleSave() {
    if (!bot) return;
    setSaving(true);
    await window.electronAPI.bot.updateConfig(bot.id, {
      systemPrompt,
      aiMode,
      apiKey,
      apiProvider,
      aiModel: model,
    });
    setSaving(false);
  }

  function selectModel(name: string) {
    setModel(name);
    setDropdownOpen(false);
  }

  const recommendedModels = [
    { name: "sweaterdog/andy-4:micro-q8_0", label: "Andy-4 Micro (Minecraft) — рекомендуется" },
    { name: "andy-4", label: "Andy-4 (Minecraft) — полная версия" },
    { name: "llama3", label: "Llama 3 8B" },
    { name: "mistral", label: "Mistral 7B" },
    { name: "gemma:2b", label: "Gemma 2B (лёгкая)" },
    { name: "phi3:mini", label: "Phi-3 Mini" },
    { name: "deepseek-r1:7b", label: "DeepSeek R1 7B" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b text-xs font-mono" style={{ borderColor: "#3a3a3a", color: "#7ecc49" }}>
        Настройки ИИ
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {!bot ? (
          <div className="text-xs text-center mt-8" style={{ color: "#555" }}>Выберите бота</div>
        ) : (
          <>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Режим ИИ</label>
              <div className="flex gap-1">
                <button
                  className="btn text-xs flex-1"
                  style={aiMode === "local" ? { borderColor: "#7ecc49", color: "#7ecc49" } : {}}
                  onClick={() => setAiMode("local")}
                >
                  Локальная
                </button>
                <button
                  className="btn text-xs flex-1"
                  style={aiMode === "api" ? { borderColor: "#3498db", color: "#3498db" } : {}}
                  onClick={() => setAiMode("api")}
                >
                  API-ключ
                </button>
              </div>
            </div>

            {aiMode === "local" ? (
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Модель Ollama
                </label>

                <div className="relative" ref={dropdownRef}>
                  <div
                    className="flex items-center gap-1 cursor-pointer"
                    style={{
                      background: "#1e1e1e",
                      border: "1px solid #3a3a3a",
                      borderRadius: 4,
                      padding: "5px 8px",
                    }}
                    onClick={() => setDropdownOpen((v) => !v)}
                  >
                    <span className="flex-1 text-xs truncate" style={{ color: "#e8e8e8" }}>
                      {model || "Выберите модель..."}
                    </span>
                    <button
                      className="text-xs ml-1"
                      style={{ color: "#555", fontSize: 10 }}
                      onClick={(e) => { e.stopPropagation(); loadInstalledModels(); }}
                      title="Обновить список"
                    >
                      {loadingModels ? "..." : "↻"}
                    </button>
                    <span style={{ color: "#555", fontSize: 10 }}>
                      {dropdownOpen ? "▲" : "▼"}
                    </span>
                  </div>

                  {dropdownOpen && (
                    <div
                      className="absolute z-50 w-full"
                      style={{
                        top: "100%",
                        left: 0,
                        background: "#1e1e1e",
                        border: "1px solid #3a3a3a",
                        borderTop: "none",
                        borderRadius: "0 0 4px 4px",
                        maxHeight: 240,
                        overflowY: "auto",
                      }}
                    >
                      {installedModels.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-xs" style={{ color: "#7ecc49", borderBottom: "1px solid #2a2a2a" }}>
                            Установленные ({installedModels.length})
                          </div>
                          {installedModels.map((m) => (
                            <div
                              key={m.name}
                              className="flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-[#2a2a2a]"
                              onClick={() => selectModel(m.name)}
                            >
                              <span className="text-xs" style={{ color: m.name === model ? "#7ecc49" : "#e8e8e8" }}>
                                {m.name === model ? "✓ " : ""}{m.name}
                              </span>
                              <span className="text-xs" style={{ color: "#555" }}>{m.size}</span>
                            </div>
                          ))}
                          <div style={{ borderTop: "1px solid #2a2a2a" }} />
                        </>
                      )}

                      <div className="px-2 py-1 text-xs" style={{ color: "#888", borderBottom: "1px solid #2a2a2a" }}>
                        Рекомендуемые
                      </div>
                      {recommendedModels.map((m) => {
                        const isInstalled = installedModels.some((im) => im.name === m.name || im.name.startsWith(m.name + ":"));
                        return (
                          <div
                            key={m.name}
                            className="flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-[#2a2a2a]"
                            onClick={() => selectModel(m.name)}
                          >
                            <span className="text-xs" style={{ color: m.name === model ? "#7ecc49" : "#c8c8c8" }}>
                              {m.name === model ? "✓ " : ""}{m.label}
                            </span>
                            {isInstalled && (
                              <span className="text-xs px-1 rounded" style={{ background: "#1a3a1a", color: "#7ecc49", border: "1px solid #3a5a3a", fontSize: 9 }}>
                                есть
                              </span>
                            )}
                          </div>
                        );
                      })}

                      <div style={{ borderTop: "1px solid #2a2a2a" }} />
                      <div className="px-2 py-1">
                        <input
                          className="input text-xs w-full"
                          placeholder="Или введи название модели вручную..."
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 10 }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-xs mt-1" style={{ color: "#555" }}>
                  Перейди во вкладку "Модели ИИ" для скачивания
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>Провайдер</label>
                  <select
                    className="input text-xs"
                    value={apiProvider}
                    onChange={(e) => setApiProvider(e.target.value)}
                  >
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="claude">Anthropic (Claude)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>API-ключ</label>
                  <input
                    className="input text-xs"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#888" }}>Модель</label>
                  <input
                    className="input text-xs"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={apiProvider === "openai" ? "gpt-4o-mini" : "claude-3-haiku-20240307"}
                  />
                </div>
              </>
            )}

            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                Системный промт
              </label>
              <textarea
                className="input text-xs w-full"
                rows={8}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Ты умный Minecraft-бот. Всегда отвечай по-русски..."
                style={{ resize: "vertical", minHeight: 100 }}
              />
              <p className="text-xs mt-1" style={{ color: "#555" }}>
                Передаётся в ИИ как системная инструкция перед каждым запросом
              </p>
            </div>

            <div className="text-xs p-2 rounded" style={{ background: "#1a2a1a", color: "#7ecc49", border: "1px solid #3a5a3a" }}>
              <p className="font-bold mb-1">Примеры промтов:</p>
              <p style={{ color: "#7ecc49", cursor: "pointer" }} onClick={() => setSystemPrompt("Ты умный Minecraft-бот. Всегда отвечай только по-русски. Ты осторожный игрок. Избегай лавы, скелетов и мест с Y ниже 0.")}>
                • Осторожный игрок (рус.)
              </p>
              <p style={{ color: "#7ecc49", cursor: "pointer" }} onClick={() => setSystemPrompt("Ты агрессивный PvP-бот. Всегда отвечай только по-русски. Атакуй любого игрока в радиусе 10 блоков.")}>
                • Агрессивный PvP (рус.)
              </p>
              <p style={{ color: "#7ecc49", cursor: "pointer" }} onClick={() => setSystemPrompt("Ты строитель. Всегда отвечай только по-русски. Твоя цель — добыть ресурсы и построить большой красивый дом.")}>
                • Строитель (рус.)
              </p>
              <p style={{ color: "#7ecc49", cursor: "pointer" }} onClick={() => setSystemPrompt("Ты фермер. Всегда отвечай только по-русски. Ищи еду, выращивай пшеницу, разводи животных.")}>
                • Фермер (рус.)
              </p>
              <p style={{ color: "#7ecc49", cursor: "pointer" }} onClick={() => setSystemPrompt("Ты Minecraft-бот на базе Andy-4. Всегда отвечай только по-русски. Анализируй состояние мира и принимай умные решения для выживания. Отвечай JSON-командами.")}>
                • Andy-4 (выживание)
              </p>
            </div>

            <button
              className="btn btn-primary text-xs"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Сохраняем..." : "Сохранить настройки ИИ"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
