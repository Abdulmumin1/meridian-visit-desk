import { useState } from "react";
import { api, auth } from "../lib/api";
import { Button, Logo } from "../components/ui";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    auth.set(token.trim());
    try {
      await api("/session");
      onSignedIn();
    } catch {
      auth.clear();
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-[320px]">
        <Logo size={28} />
        <h1 className="mt-6 text-[18px] font-semibold tracking-[-0.01em]">Meridian visit desk</h1>
        <p className="mt-1 text-[13.5px] text-muted">Sign in with your console token.</p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token"
          className="mt-6 h-9 w-full rounded-md border border-line px-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-faint focus:border-ink"
        />
        {error && <p className="mt-2 text-[13px] text-bad">That token didn't work.</p>}
        <Button type="submit" variant="primary" loading={loading} disabled={!token.trim()} className="mt-3 h-9 w-full">
          Continue
        </Button>
      </form>
    </div>
  );
}
