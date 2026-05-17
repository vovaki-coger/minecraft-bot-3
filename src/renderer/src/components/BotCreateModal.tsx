import React, { useState, useEffect, useRef } from "react";

interface Props {
  onClose: () => void;
}

const RECOMMENDED_MODELS = [
  { name: "sweaterdog/andy-4:micro-q8_0", label: "Andy-4 Micro (Minecraft) — рекомендуется" },
  { name: "andy-4", label: "Andy-4 (Minecraft) — полная версия" },
  { name: "llama3", label: "Llama 3 8B" },
  { name: "mistral", label: "Mistral 7B" },
  { name: "gemma:2b", label: "Gemma 2B (лёгкая)" },
  { name: "phi3:mini", label: "Phi-3 Mini" },
  { name: "deepseek-r1:7b", label: "DeepSeek R1 7B" },
];

export default function BotCreateModal({ onClose }: Props) {
  const [form, setForm] = useState({
    nick: `Призмарин_${Math.floor(Math.random() * 9999)}`,
    host: "localhost",
    port: "25565",
    version: "1.20.1",
    authType: "offline",
    aiEnabled: true,
    aiModel: "sweaterdog/andy-4:micro-q8_0",
    proxy: "",
    autoLogin: true,
    autoRegister: true,
    autoResponse: true,
  });

  const [installedModels, setInstalledModels] = useState<{ name: string; size: string }[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const versions = ["1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9"];

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadModels() {
    setLoadingModels(true);
    try {
      const result = await window.electronAPI.ollama.listInstalledModels();
      setInstalledModels(result);
    } catch {}
    setLoadingModels(false);
  }

  async function handleCreate() {
    await window.electronAPI.bot.create(form);
    onClose();
  }

  function update(key: string, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function selectModel(name: string) {
    update("aiModel", name);
    setDropdownOpen(false);
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel p-5 w-96" style={{ borderColor: "#5b8c3e" }}>
        <h2 className="text-sm font-mono mb-4" style={{ color: "#7ecc49" }}>
          + Создать нового бота
        </h2>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Ник бота</label>
            <input className="input" value={form.nick} onChange={(e) => update("nick", e.target.value)} />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>IP сервера</label>
              <input className="input" value={form.host} onChange={(e) => update("host", e.target.value)} />
            </div>
            <div style={{ width: 80 }}>
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Порт</label>
              <input className="input" value={form.port} onChange={(e) => update("port", e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Версия MC</label>
              <select className="input" value={form.version} onChange={(e) => update("version", e.target.value)}>
                {versions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>Авторизация</label>
              <select className="input" value={form.authType} onChange={(e) => update("authType", e.target.value)}>
                <option value="offline">Офлайн</option>
                <option value="microsoft">Microsoft</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Модель ИИ</label>
            <div className="relative" ref={dropdownRef}>
              <div
                className="flex items-center gap-1 cursor-pointer"
                style={{
                  background: "#1e1e1e",
                  border: "1px solid #3a3a3a",
                  borderRadius: 4,
                  padding: "6px 8px",
                }}
                onClick={() => setDropdownOpen((v) => !v)}
              >
                <span className="flex-1 text-xs truncate" style={{ color: "#e8e8e8" }}>
                  {form.aiModel || "Выберите модель..."}
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); loadModels(); }}
                  style={{ color: "#555", fontSize: 11, cursor: "pointer" }}
                  title="Обновить список"
                >
                  {loadingModels ? "..." : "↻"}
                </span>
                <span style={{ color: "#555", fontSize: 10 }}>{dropdownOpen ? "▲" : "▼"}</span>
              </div>

              {dropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#1e1e1e",
                    border: "1px solid #3a3a3a",
                    borderTop: "none",
                    borderRadius: "0 0 4px 4px",
                    maxHeight: 200,
                    overflowY: "auto",
                    zIndex: 100,
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
                          className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
                          style={{ background: form.aiModel === m.name ? "#2a3a2a" : undefined }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = form.aiModel === m.name ? "#2a3a2a" : "")}
                          onClick={() => selectModel(m.name)}
                        >
                          <span className="text-xs" style={{ color: form.aiModel === m.name ? "#7ecc49" : "#e8e8e8" }}>
                            {form.aiModel === m.name ? "✓ " : ""}{m.name}
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
                  {RECOMMENDED_MODELS.map((m) => {
                    const installed = installedModels.some((im) => im.name === m.name);
                    return (
                      <div
                        key={m.name}
                        className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
                        style={{ background: form.aiModel === m.name ? "#2a3a2a" : undefined }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = form.aiModel === m.name ? "#2a3a2a" : "")}
                        onClick={() => selectModel(m.name)}
                      >
                        <span className="text-xs" style={{ color: form.aiModel === m.name ? "#7ecc49" : "#c8c8c8" }}>
                          {form.aiModel === m.name ? "✓ " : ""}{m.label}
                        </span>
                        {installed && (
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
                      placeholder="Или введи вручную..."
                      value={form.aiModel}
                      onChange={(e) => update("aiModel", e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 10 }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Прокси (необязательно)</label>
            <input className="input" value={form.proxy} onChange={(e) => update("proxy", e.target.value)} placeholder="socks5://IP:порт" />
          </div>

          <div className="flex gap-3 flex-wrap text-xs" style={{ color: "#888" }}>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.aiEnabled} onChange={(e) => update("aiEnabled", e.target.checked)} style={{ accentColor: "#7ecc49" }} />
              ИИ включён
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.autoResponse} onChange={(e) => update("autoResponse", e.target.checked)} style={{ accentColor: "#7ecc49" }} />
              Автоответ
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.autoLogin} onChange={(e) => update("autoLogin", e.target.checked)} style={{ accentColor: "#7ecc49" }} />
              Авто-логин
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.autoRegister} onChange={(e) => update("autoRegister", e.target.checked)} style={{ accentColor: "#7ecc49" }} />
              Авто-рег
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button className="btn btn-primary flex-1" onClick={handleCreate}>Создать</button>
          <button className="btn" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
