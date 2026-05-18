const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const log = require("electron-log");

const execAsync = promisify(exec);

const OLLAMA_API = "http://localhost:11434";

const MODEL_CATALOG = [
  { name: "andy-4", displayName: "Andy-4 (Minecraft ИИ)", size: "~5GB", vram: "6GB", description: "ИИ специально для Minecraft от sweaterdog", tag: "minecraft" },
  { name: "sweaterdog/andy-4:micro-q8_0", displayName: "Andy-4 Micro Q8 (Minecraft)", size: "~2GB", vram: "3GB", description: "Лёгкая версия Andy-4 — лучший выбор для Minecraft", tag: "minecraft" },
  { name: "llama3", displayName: "Llama 3 8B", size: "4.7GB", vram: "6GB", description: "Мощная модель от Meta" },
  { name: "llama3:70b", displayName: "Llama 3 70B", size: "40GB", vram: "48GB", description: "Большая версия Llama 3" },
  { name: "mistral", displayName: "Mistral 7B", size: "4.1GB", vram: "6GB", description: "Быстрая и умная модель" },
  { name: "mistral:instruct", displayName: "Mistral Instruct", size: "4.1GB", vram: "6GB", description: "Оптимизирована для инструкций" },
  { name: "gemma:2b", displayName: "Gemma 2B", size: "1.4GB", vram: "3GB", description: "Лёгкая модель от Google" },
  { name: "gemma:7b", displayName: "Gemma 7B", size: "5.0GB", vram: "8GB", description: "Средняя модель от Google" },
  { name: "codellama", displayName: "CodeLlama 7B", size: "3.8GB", vram: "6GB", description: "Специализирована на коде" },
  { name: "deepseek-coder", displayName: "DeepSeek Coder", size: "3.8GB", vram: "6GB", description: "Китайская кодовая модель" },
  { name: "deepseek-r1:7b", displayName: "DeepSeek R1 7B", size: "4.7GB", vram: "6GB", description: "Рассуждающая модель" },
  { name: "phi3:mini", displayName: "Phi-3 Mini", size: "2.2GB", vram: "4GB", description: "Компактная от Microsoft" },
  { name: "phi3:medium", displayName: "Phi-3 Medium", size: "7.9GB", vram: "10GB", description: "Средняя от Microsoft" },
  { name: "qwen2:7b", displayName: "Qwen 2 7B", size: "4.4GB", vram: "6GB", description: "Alibaba модель" },
  { name: "neural-chat", displayName: "Neural Chat", size: "4.1GB", vram: "6GB", description: "Intel оптимизация" },
  { name: "orca-mini", displayName: "Orca Mini", size: "2.0GB", vram: "4GB", description: "Лёгкая обучающая модель" },
];

class OllamaManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.isInstalled = false;
    this.isRunning = false;
  }

  async checkOllama() {
    try {
      const response = await this._fetch(`${OLLAMA_API}/api/tags`);
      this.isInstalled = true;
      this.isRunning = true;
      return { installed: true, running: true, models: response.models || [] };
    } catch {
      const installed = await this._checkBinary();
      return { installed, running: false, models: [] };
    }
  }

  async _checkBinary() {
    try {
      await execAsync("ollama --version");
      this.isInstalled = true;
      return true;
    } catch {
      return false;
    }
  }

  async installOllama() {
    const platform = os.platform();
    log.info(`Installing Ollama on ${platform}`);

    if (platform === "win32") {
      return this._installWindows();
    } else if (platform === "linux") {
      return this._installLinux();
    } else if (platform === "darwin") {
      return this._installMac();
    }
    throw new Error("Unsupported platform");
  }

  async _installWindows() {
    const installerPath = path.join(os.tmpdir(), "OllamaSetup.exe");
    await this._download(
      "https://ollama.com/download/OllamaSetup.exe",
      installerPath
    );
    await execAsync(`"${installerPath}" /S`);
    return { success: true };
  }

  async _installLinux() {
    await execAsync(
      'curl -fsSL https://ollama.com/install.sh | sh',
      { timeout: 120000 }
    );
    return { success: true };
  }

  async _installMac() {
    const dmgPath = path.join(os.tmpdir(), "Ollama.dmg");
    await this._download("https://ollama.com/download/Ollama-darwin.zip", dmgPath);
    return {
      success: false,
      message: "Скачайте Ollama с https://ollama.com/download и установите вручную",
    };
  }

  async _download(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (response) => {
        response.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", reject);
    });
  }

  async listModels() {
    try {
      const response = await this._fetch(`${OLLAMA_API}/api/tags`);
      const installed = (response.models || []).map((m) => m.name);

      const catalogModels = MODEL_CATALOG.map((model) => ({
        ...model,
        installed: installed.some(
          (i) => i === model.name || i.startsWith(model.name + ":")
        ),
      }));

      const catalogNames = MODEL_CATALOG.map((m) => m.name);
      const extraModels = installed
        .filter((name) => !catalogNames.some((cn) => name === cn || name.startsWith(cn + ":")))
        .map((name) => ({
          name,
          displayName: name,
          size: "?",
          vram: "?",
          description: "Локальная модель",
          installed: true,
          isLocal: true,
        }));

      return [...catalogModels, ...extraModels];
    } catch {
      return MODEL_CATALOG.map((m) => ({ ...m, installed: false }));
    }
  }

  async listInstalledModels() {
    try {
      const response = await this._fetch(`${OLLAMA_API}/api/tags`);
      return (response.models || []).map((m) => ({
        name: m.name,
        size: this._formatBytes(m.size || 0),
        modifiedAt: m.modified_at,
      }));
    } catch {
      return [];
    }
  }


  /**
   * Возвращает лучшую доступную модель для Minecraft.
   * Приоритет: Andy-4 → другие andy-модели → первая установленная.
   */
  async getPreferredModel() {
    try {
      const response = await this._fetch(OLLAMA_API + '/api/tags');
      const models = (response.models || []).map(m => m.name);
      if (models.length === 0) return null;
      const andy4 = models.find(m => m.includes('sweaterdog/andy-4') || m === 'andy-4');
      if (andy4) return andy4;
      const andy = models.find(m => m.toLowerCase().includes('andy'));
      if (andy) return andy;
      return models[0];
    } catch {
      return null;
    }
  }

  _formatBytes(bytes) {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} ГБ`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} МБ`;
    return `${bytes} Б`;
  }

  async pullModel(modelName, onProgress) {
    const { default: fetch } = await import("node-fetch");

    const response = await fetch(`${OLLAMA_API}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Ошибка сервера Ollama: HTTP ${response.status}`);
    }

    return new Promise((resolve, reject) => {
      const stream = response.body;
      let buffer = "";
      let lastTotal = 0;

      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (data.total && data.total > 0) {
              lastTotal = data.total;
              const completed = data.completed || 0;
              const percent = Math.round((completed / data.total) * 100);
              const downloadedGB = (completed / 1e9).toFixed(2);
              const totalGB = (data.total / 1e9).toFixed(2);
              if (onProgress) {
                onProgress({
                  status: `${downloadedGB} / ${totalGB} ГБ`,
                  downloaded: completed,
                  total: data.total,
                  percent,
                  done: false,
                });
              }
            } else if (data.status) {
              if (data.status === "success") {
                if (onProgress) onProgress({ status: "Готово!", downloaded: lastTotal, total: lastTotal, percent: 100, done: true });
              } else {
                if (onProgress) onProgress({ status: data.status, downloaded: 0, total: lastTotal, percent: 0, done: false });
              }
            }
          } catch {
          }
        }
      });

      stream.on("end", () => {
        if (onProgress) onProgress({ status: "Готово!", downloaded: lastTotal, total: lastTotal, percent: 100, done: true });
        resolve({ success: true });
      });

      stream.on("error", (err) => {
        reject(new Error(`Ошибка загрузки: ${err.message}`));
      });
    });
  }

  async deleteModel(modelName) {
    try {
      await execAsync(`ollama rm ${modelName}`);
      return { success: true };
    } catch (err) {
      throw new Error(`Не удалось удалить модель: ${err.message}`);
    }
  }

  async getRunningModels() {
    try {
      const response = await this._fetch(`${OLLAMA_API}/api/ps`);
      return response.models || [];
    } catch {
      return [];
    }
  }

  async loadCustomModel(filePath) {
    const modelName = path.basename(filePath, ".gguf").toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const modelfilePath = path.join(os.tmpdir(), `Modelfile_${modelName}`);
    fs.writeFileSync(modelfilePath, `FROM "${filePath}"\n`);

    try {
      await execAsync(`ollama create ${modelName} -f "${modelfilePath}"`);
      return { success: true, modelName };
    } catch (err) {
      throw new Error(`Не удалось загрузить модель: ${err.message}`);
    }
  }

  async chat({ model, messages, systemPrompt, apiKey, apiProvider, mode }) {
    if (mode === "api") {
      return this._chatAPI({ model, messages, systemPrompt, apiKey, apiProvider });
    }
    return this._chatOllama({ model, messages, systemPrompt });
  }

  async _chatOllama({ model, messages, systemPrompt }) {
    const allMessages = [];
    if (systemPrompt) {
      allMessages.push({ role: "system", content: systemPrompt });
    }
    allMessages.push(...messages);

    const response = await this._fetch(`${OLLAMA_API}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: allMessages,
        stream: false,
      }),
    });

    return { content: response.message?.content || "", model };
  }

  async _chatAPI({ model, messages, systemPrompt, apiKey, apiProvider }) {
    let url, headers, body;

    if (apiProvider === "openai" || !apiProvider) {
      url = "https://api.openai.com/v1/chat/completions";
      headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      const allMessages = [];
      if (systemPrompt) allMessages.push({ role: "system", content: systemPrompt });
      allMessages.push(...messages);
      body = JSON.stringify({ model: model || "gpt-4o-mini", messages: allMessages });
    } else if (apiProvider === "claude") {
      url = "https://api.anthropic.com/v1/messages";
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({
        model: model || "claude-3-haiku-20240307",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });
    }

    const resp = await this._fetch(url, { method: "POST", headers, body });

    if (apiProvider === "claude") {
      return { content: resp.content?.[0]?.text || "", model };
    }
    return { content: resp.choices?.[0]?.message?.content || "", model };
  }

  async _fetch(url, options = {}) {
    const { default: fetch } = await import("node-fetch");
    const defaultHeaders = { "Content-Type": "application/json" };
    const resp = await fetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers || {}) },
      timeout: 60000,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }
}

module.exports = { OllamaManager, MODEL_CATALOG };
