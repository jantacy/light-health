"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function LicenseAdminPage() {
  const [secret, setSecret] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function issue(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setLicense(""); setMessage(""); setCopied(false);
    try {
      const response = await fetch("/api/admin/licenses", { method: "POST", headers: { "Content-Type": "application/json", "x-license-admin-key": secret }, body: JSON.stringify({ phone: phone.trim() }) });
      const result = await response.json().catch(() => ({ error: "签发服务暂时不可用，请稍后再试。" }));
      if (!response.ok) throw new Error(result.error || "签发失败");
      setLicense(result.license); setMessage(`已为 ${result.phone} 签发。此 License 只会显示这一次。`);
    } catch (err) { setMessage(err instanceof Error ? err.message : "签发失败"); }
    finally { setBusy(false); }
  }

  async function copyLicense() {
    await navigator.clipboard.writeText(license); setCopied(true);
  }

  return <main className="auth-screen"><section className="auth-card admin-card"><img className="brand-mark" src="/icon.svg" alt=""/><span className="eyebrow">PRIVATE ACCESS</span><h1>签发 License</h1><p className="auth-copy">输入受邀者手机号，服务端会生成与该号码绑定的专属 License。重新签发会立即让旧 License 失效。</p><form className="auth-form" onSubmit={issue}><label htmlFor="admin-secret">管理员密钥</label><input id="admin-secret" type="password" autoComplete="off" required minLength={32} placeholder="服务端 LICENSE_ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)}/><label htmlFor="invite-phone">手机号</label><input id="invite-phone" type="tel" autoComplete="off" required placeholder="13800000000" value={phone} onChange={(e) => setPhone(e.target.value)}/><button className="primary-button" disabled={busy}>{busy ? "正在签发…" : "生成 License"}</button></form>{message && <p className="form-message">{message}</p>}{license && <div className="license-result"><code>{license}</code><button type="button" onClick={copyLicense}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "已复制" : "复制"}</button></div>}<p className="tiny-note">请使用 HTTPS，并妥善保管管理员密钥与签发结果</p></section></main>;
}
