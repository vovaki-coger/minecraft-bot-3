import React, { useState, useEffect } from "react";
import { useAppStore, ModelInfo } from "../../store/appStore";

export default function ModelsTab() {
  const { models, setModels, pullProgresses } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [runningModels, setRunningModels] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string>("all");

  useEffect(() => {
    loadModels();
    loadRunningModels();
  }, []);

  async function loadModels() {
    setLoading(true);
    const result = await window.electronAPI.ollama.listModels();
    setModels(result);
    setLoading(false);
  }

  async function loadRunningModels() {
    const result = await window.electronAPI.ollama.getRunningModels();
    setRunningModels(result.map((m: any) => m.name));
  }

  async function handlePull(model: ModelInfo) {
    setPullingModel(model.name);
    try {
      await window.electronAPI.ollama.pullModel(model.name);
      await loadModels();
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    } finally {
      setPullingModel(null);
    }
  }

  async function handleDelete(model: ModelInfo) {
    if (!confirm(`Удалить модель ${model.displayName}?`)) return;
    try {
      await window.electronAPI.ollama.deleteModel(model.name);
      await loadModels();
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    }
  }

  async function handleLoadCustom() {
    const filePath = await window.electronAPI.dialog.openFile();
    if (!filePath) return;
    try {
      const result = await window.electronAPI.ollama.loadCustomModel(filePath);
      alert(`Модель "${result.modelName}" успешно загружена!`);
      await loadModels();
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    }
  }

  const filteredModels = filterTag === "all"
    ? models
    : filterTag === "installed"
    ? models.filter((m) => m.installed)
    : models.filter((m) => (m as any).tag === filterTag);

  const activeDownload = pullingModel ? pullProgresses[pullingModel] : null;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ position: "relative" }}>
      {pullingModel && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div style={{ fontSize: 32 }}>⬇️</div>
          <div className="text-sm font-mono" style={{ color: "#7ecc49" }}>
            Загрузка модели...
          </div>
          <div className="text-xs" style={{ color: "#aaa", maxWidth: 220, textAlign: "center" }}>
            {pullingModel}
          </div>

          <div style={{ width: 260 }}>
            <div
              style={{
                background: "#1a1a1a",
                border: "1px solid #3a3a3a",
                borderRadius: 4,
                height: 14,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  background: "linear-gradient(90deg, #5b8c3e, #7ecc49)",
                  width: activeDownload?.percent != null
                    ? `${activeDownload.percent}%`
                    : "30%",
                  transition: "width 0.4s ease",
                  borderRadius: 4,
                }}
              />
            </div>
            <div
              className="flex justify-between mt-1 text-xs"
              style={{ color: "#888" }}
            >
              <span>{activeDownload?.status || "Подготовка..."}</span>
              <span>
                {activeDownload?.percent != null ? `${activeDownload.percent}%` : ""}
              </span>
            </div>
            {activeDownload && activeDownload.total > 0 && (
              <div className="text-center text-xs mt-1" style={{ color: "#7ecc49" }}>
                {(activeDownload.downloaded / 1e9).toFixed(2)} / {(activeDownload.total / 1e9).toFixed(2)} ГБ
              </div>
            )}
          </div>

          <p className="text-xs" style={{ color: "#555" }}>Не закрывайте приложение</p>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "#3a3a3a" }}>
        <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>Каталог моделей</span>
        <div className="flex gap-1">
          <button className="btn text-xs" onClick={loadModels} disabled={loading}>
            {loading ? "..." : "↻"}
          </button>
          <button className="btn text-xs" onClick={handleLoadCustom} style={{ color: "#3498db", borderColor: "#3498db" }}>
            GGUF
          </button>
        </div>
      </div>

      <div className="flex gap-1 px-3 py-1.5 border-b" style={{ borderColor: "#2a2a2a" }}>
        {["all", "minecraft", "installed"].map((tag) => (
          <button
            key={tag}
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: filterTag === tag ? "#3a5a3a" : "#1e1e1e",
              color: filterTag === tag ? "#7ecc49" : "#666",
              border: `1px solid ${filterTag === tag ? "#5b8c3e" : "#2a2a2a"}`,
              cursor: "pointer",
              fontSize: 10,
            }}
            onClick={() => setFilterTag(tag)}
          >
            {tag === "all" ? "Все" : tag === "minecraft" ? "Minecraft ИИ" : "Установленные"}
          </button>
        ))}
        <span className="ml-auto text-xs" style={{ color: "#555", fontSize: 10 }}>
          {models.filter((m) => m.installed).length} / {models.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {filteredModels.map((model) => {
          const progress = pullProgresses[model.name];
          const isPulling = pullingModel === model.name;
          const isRunning = runningModels.includes(model.name);
          const isMinecraft = (model as any).tag === "minecraft";

          return (
            <div
              key={model.name}
              className="panel p-2.5"
              style={{
                borderColor: isMinecraft && model.installed
                  ? "#5b8c3e"
                  : model.installed
                  ? "#3a5a3a"
                  : isMinecraft
                  ? "#3a4a2a"
                  : "#3a3a3a",
                background: isMinecraft ? "#131a10" : undefined,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-mono" style={{ color: model.installed ? "#7ecc49" : "#e8e8e8" }}>
                      {model.displayName}
                    </span>
                    {isMinecraft && (
                      <span className="text-xs px-1 rounded" style={{ background: "#1a3a10", color: "#7ecc49", border: "1px solid #3a6a20", fontSize: 9 }}>
                        Minecraft
                      </span>
                    )}
                    {isRunning && (
                      <span className="text-xs px-1 rounded pulse" style={{ background: "#1a3a1a", color: "#7ecc49", border: "1px solid #5b8c3e", fontSize: 9 }}>
                        ЗАПУЩЕНА
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "#666" }}>{model.description}</p>
                  <div className="flex gap-3 mt-1 text-xs" style={{ color: "#555" }}>
                    {model.size !== "?" && <span>{model.size}</span>}
                    {model.vram !== "?" && <span>VRAM: {model.vram}</span>}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "#444", fontSize: 9 }}>{model.name}</p>
                </div>

                <div className="flex flex-col gap-1 flex-shrink-0">
                  {model.installed ? (
                    <button
                      className="btn btn-danger text-xs py-0.5 px-2"
                      onClick={() => handleDelete(model)}
                      style={{ fontSize: 10 }}
                    >
                      Удалить
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary text-xs py-0.5 px-2"
                      onClick={() => handlePull(model)}
                      disabled={!!pullingModel}
                      style={{ fontSize: 10 }}
                    >
                      {isPulling ? "..." : "Скачать"}
                    </button>
                  )}
                </div>
              </div>

              {isPulling && progress && (
                <div className="mt-2">
                  <div
                    style={{
                      background: "#1a1a1a",
                      border: "1px solid #2a2a2a",
                      borderRadius: 3,
                      height: 10,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: "linear-gradient(90deg, #5b8c3e, #7ecc49)",
                        width: progress.done
                          ? "100%"
                          : progress.percent != null
                          ? `${progress.percent}%`
                          : "20%",
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <p className="text-xs" style={{ color: "#888" }}>{progress.status}</p>
                    {progress.total > 0 && (
                      <p className="text-xs" style={{ color: "#7ecc49" }}>
                        {(progress.downloaded / 1e9).toFixed(2)} / {(progress.total / 1e9).toFixed(2)} ГБ
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredModels.length === 0 && !loading && (
          <div className="text-center mt-8 text-xs" style={{ color: "#555" }}>
            <p>Нет моделей в этой категории.</p>
            <button className="btn mt-3 text-xs" onClick={loadModels}>Обновить</button>
          </div>
        )}
      </div>
    </div>
  );
}
