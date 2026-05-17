import React, { useState, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

export default function SettingsTab() {
  const { globalPassword, globalProxy } = useAppStore();
  const [password, setPassword] = useState(globalPassword || "");
  const [proxy, setProxy] = useState(globalProxy || "");
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [proxyResult, setProxyResult] = useState<string | null>(null);
  const [testingProxy, setTestingProxy] = useState(false);

  useEffect(() => {
    window.electronAPI.config.getGlobalPassword().then((p: string) => setPassword(p));
    window.electronAPI.config.get().then((cfg: any) => setProxy(cfg.globalProxy || ""));
  }, []);

  async function handleSavePassword() {
    await window.electronAPI.config.setGlobalPassword(password);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSaveProxy() {
    await window.electronAPI.config.set("globalProxy", proxy);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTestProxy() {
    if (!proxy.trim()) return;
    setTestingProxy(true);
    setProxyResult(null);
    const result = await window.electronAPI.proxy.check(proxy);
    setProxyResult(result.success ? `✅ Работает! IP: ${result.ip}` : `❌ Ошибка: ${result.error}`);
    setTestingProxy(false);
  }

  async function handleOpenOllamaSite() {
    await window.electronAPI.shell.openExternal("https://ollama.com");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b text-xs font-mono" style={{ borderColor: "#3a3a3a", color: "#7ecc49" }}>
        ⚙️ Глобальные настройки
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>
            🔑 Общий пароль для серверов
          </h3>
          <p className="text-xs mb-2" style={{ color: "#666" }}>
            Все боты используют этот пароль для /register и /login
          </p>
          <div className="flex gap-1">
            <input
              className="input text-xs flex-1"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль..."
            />
            <button
              className="btn text-xs"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
          <button className="btn btn-primary text-xs w-full mt-2" onClick={handleSavePassword}>
            {saved ? "✅ Сохранено!" : "💾 Сохранить пароль"}
          </button>
        </div>

        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>
            🔒 Общий прокси по умолчанию
          </h3>
          <p className="text-xs mb-2" style={{ color: "#666" }}>
            Применяется к ботам без индивидуального прокси
          </p>
          <input
            className="input text-xs mb-2"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder="socks5://IP:порт или логин:пароль@IP:порт"
          />
          <div className="flex gap-1">
            <button className="btn btn-primary text-xs flex-1" onClick={handleSaveProxy}>
              💾 Сохранить
            </button>
            <button
              className="btn text-xs"
              onClick={handleTestProxy}
              disabled={testingProxy || !proxy.trim()}
            >
              {testingProxy ? "⏳" : "🔍 Тест"}
            </button>
          </div>
          {proxyResult && (
            <div
              className="mt-2 p-2 rounded text-xs"
              style={{
                background: proxyResult.startsWith("✅") ? "#1a2a1a" : "#2a1a1a",
                color: proxyResult.startsWith("✅") ? "#7ecc49" : "#e74c3c",
                border: `1px solid ${proxyResult.startsWith("✅") ? "#3a5a3a" : "#5a3a3a"}`,
              }}
            >
              {proxyResult}
            </div>
          )}
        </div>

        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-3" style={{ color: "#7ecc49" }}>🤖 Ollama</h3>
          <button className="btn text-xs w-full mb-2" onClick={handleOpenOllamaSite}>
            🌐 Сайт Ollama
          </button>
          <div className="text-xs" style={{ color: "#555" }}>
            <p>Ollama запускается автоматически на localhost:11434</p>
            <p className="mt-1">Для добавления моделей используй вкладку "Модели ИИ"</p>
          </div>
        </div>

        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>📋 О приложении</h3>
          <div className="text-xs" style={{ color: "#666", lineHeight: 1.6 }}>
            <p>Minecraft Bot v1.0.0</p>
            <p>ИИ: Ollama (локально) + OpenAI/Claude (API)</p>
            <p>Движок: Mineflayer (Java Edition)</p>
            <p>Мультибот: неограниченное количество</p>
            <p>Настройки хранятся отдельно от EXE</p>
          </div>
        </div>
      </div>
    </div>
  );
}
