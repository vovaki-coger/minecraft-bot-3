import React, { useState } from "react";

interface Props {
  onComplete: () => void;
}

export default function OllamaSetup({ onComplete }: Props) {
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleInstall() {
    setInstalling(true);
    setError("");
    setStatus("Загружаем установщик Ollama...");

    try {
      const result = await window.electronAPI.ollama.install();
      if (result.success === false && result.message) {
        setError(result.message);
        setInstalling(false);
        return;
      }

      setStatus("Устанавливаем Ollama...");
      await new Promise((r) => setTimeout(r, 3000));

      const check = await window.electronAPI.ollama.check();
      if (check.installed) {
        setStatus("Ollama успешно установлена!");
        setTimeout(onComplete, 1500);
      } else {
        setError("Установка завершена, но Ollama не обнаружена. Перезапустите приложение.");
      }
    } catch (err: any) {
      setError(`Ошибка: ${err.message}`);
    } finally {
      setInstalling(false);
    }
  }

  async function handleSkip() {
    onComplete();
  }

  async function handleOpenSite() {
    await window.electronAPI.shell.openExternal("https://ollama.com/download");
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full" style={{ background: "#1a1a1a", padding: "40px" }}>
      <div className="panel p-8 max-w-lg w-full text-center" style={{ borderColor: "#5b8c3e" }}>
        <div className="text-5xl mb-4">🤖</div>
        <h1 className="text-xl font-mono mb-2" style={{ color: "#7ecc49" }}>
          Ollama не обнаружена
        </h1>
        <p className="mb-6" style={{ color: "#888", lineHeight: 1.6 }}>
          Ollama — локальный ИИ-сервер, необходимый для работы нейросетей.
          Без него бот не сможет принимать умные решения.
        </p>

        {status && (
          <div className="mb-4 p-3 rounded text-sm" style={{ background: "#1a2a1a", color: "#7ecc49" }}>
            {status}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded text-sm" style={{ background: "#2a1a1a", color: "#e74c3c" }}>
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            className="btn btn-primary w-full py-3"
            onClick={handleInstall}
            disabled={installing}
          >
            {installing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-t-transparent rounded-full spin" style={{ borderColor: "#fff" }} />
                {status || "Устанавливаем..."}
              </span>
            ) : (
              "⬇️ Автоматически установить Ollama"
            )}
          </button>

          <button className="btn w-full" onClick={handleOpenSite}>
            🌐 Открыть ollama.com/download
          </button>

          <button className="btn w-full" onClick={handleSkip} style={{ color: "#888" }}>
            Пропустить (буду использовать API-ключ)
          </button>
        </div>

        <div className="mt-6 text-xs" style={{ color: "#555" }}>
          После установки Ollama перезапустите приложение или нажмите "Автоматически установить"
        </div>
      </div>
    </div>
  );
}
