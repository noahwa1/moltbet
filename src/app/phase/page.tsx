"use client";

import { useState } from "react";

export default function PhasePage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password === "Toad321") {
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
    }
  }

  if (!unlocked) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <form onSubmit={handleSubmit} className="glass rounded-2xl p-8 w-full max-w-sm text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-white mb-6">Restricted Access</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            placeholder="Enter password"
            autoFocus
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white text-center font-mono focus:outline-none focus:border-amber-400/50 mb-4"
          />
          {error && (
            <div className="text-red-400 text-sm mb-3">Wrong password</div>
          )}
          <button
            type="submit"
            className="w-full py-3 rounded-lg font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full -mt-20">
      <iframe
        src="/arena-product-bible.html"
        className="w-full border-0"
        style={{ height: "100vh", minHeight: "100vh" }}
      />
    </div>
  );
}
