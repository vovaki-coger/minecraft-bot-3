const log = require("electron-log");

const REGISTER_PATTERNS = [
  /\/register/i, /зарегистрируйтесь/i, /register/i, /\/reg /i,
];
const LOGIN_PATTERNS = [
  /\/login/i, /войдите/i, /авторизуйтесь/i, /login/i,
];
const MATH_PATTERN = /(\d+)\s*([+\-*\/])\s*(\d+)/;
const WRITE_NUMBER_PATTERN = /напишите\s+(\d+)/i;
const SOLVE_PATTERN = /реши[тье]*\s+(.+)/i;

class CaptchaHandler {
  constructor(botInstance, ollamaManager) {
    this.instance = botInstance;
    this.ollamaManager = ollamaManager;
    this.pendingCaptcha = false;
  }

  async handleChatCaptcha(message) {
    if (this.pendingCaptcha) return;

    const mathMatch = message.match(MATH_PATTERN);
    if (mathMatch) {
      this.pendingCaptcha = true;
      const [, a, op, b] = mathMatch;
      let result;
      switch (op) {
        case "+": result = parseInt(a) + parseInt(b); break;
        case "-": result = parseInt(a) - parseInt(b); break;
        case "*": result = parseInt(a) * parseInt(b); break;
        case "/": result = Math.round(parseInt(a) / parseInt(b)); break;
      }
      setTimeout(() => {
        this.instance.bot?.chat(String(result));
        this.pendingCaptcha = false;
        log.info(`Solved math captcha: ${a}${op}${b}=${result}`);
      }, 1500);
      return;
    }

    const writeMatch = message.match(WRITE_NUMBER_PATTERN);
    if (writeMatch) {
      this.pendingCaptcha = true;
      setTimeout(() => {
        this.instance.bot?.chat(writeMatch[1]);
        this.pendingCaptcha = false;
      }, 1500);
      return;
    }

    if (this._isComplexCaptcha(message)) {
      await this._handleWithAI(message);
    }
  }

  _isComplexCaptcha(message) {
    const keywords = ["капча", "captcha", "докажи", "verify", "verification", "какой цвет", "what color", "сколько"];
    return keywords.some((k) => message.toLowerCase().includes(k));
  }

  async _handleWithAI(message) {
    if (!this.instance.aiEnabled) return;
    this.pendingCaptcha = true;

    try {
      const response = await this.ollamaManager.chat({
        model: this.instance.config.aiModel || "llama3",
        mode: this.instance.config.aiMode || "local",
        apiKey: this.instance.config.apiKey,
        apiProvider: this.instance.config.apiProvider,
        systemPrompt: "Ты проходишь капчу в игре Minecraft. Отвечай кратко, только ответ на вопрос.",
        messages: [
          { role: "user", content: `Сервер написал: "${message}". Что нужно ответить? Дай только ответ, без объяснений.` },
        ],
      });
      if (response.content) {
        const answer = response.content.trim().slice(0, 50);
        setTimeout(() => {
          this.instance.bot?.chat(answer);
          this.pendingCaptcha = false;
        }, 2000);
      }
    } catch (err) {
      log.error("Captcha AI error:", err.message);
      this.pendingCaptcha = false;
    }
  }
}

module.exports = { CaptchaHandler };
