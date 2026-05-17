import React, { useState } from "react";

interface Props {
  onClose: () => void;
}

export default function BotCreateModal({ onClose }: Props) {
  const [form, setForm] = useState({
    nick: `Bot_${Math.floor(Math.random() * 9999)}`,
    host: "localhost",
    port: "25565",
    version: "1.20.1",
    authType: "offline",
    aiEnabled: true,
    aiModel: "llama3",
    proxy: "",
    autoLogin: true,
    autoRegister: true,
  });

  const versions = ["1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9"];

  async function handleCreate() {
    await window.electronAPI.bot.create(form);
    onClose();
  }

  function update(key: string, value: any) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel p-5 w-96" style={{ borderColor: "#5b8c3e" }}>
        <h2 className="text-sm font-mono mb-4" style={{ color: "#7ecc49" }}>
          ➕ Создать нового бота
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
            <input className="input" value={form.aiModel} onChange={(e) => update("aiModel", e.target.value)} placeholder="llama3" />
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "#888" }}>Прокси (необязательно)</label>
            <input className="input" value={form.proxy} onChange={(e) => update("proxy", e.target.value)} placeholder="socks5://IP:порт" />
          </div>

          <div className="flex gap-4 text-xs" style={{ color: "#888" }}>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.aiEnabled} onChange={(e) => update("aiEnabled", e.target.checked)} />
              ИИ включён
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.autoLogin} onChange={(e) => update("autoLogin", e.target.checked)} />
              Авто-логин
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.autoRegister} onChange={(e) => update("autoRegister", e.target.checked)} />
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
