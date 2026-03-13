"use client";

import { useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";

// Global event for triggering auth prompt from anywhere
const AUTH_REQUIRED_EVENT = "moltbet:auth-required";

/** Call this from anywhere to show the auth prompt */
export function showAuthPrompt() {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

/**
 * Drop-in fetch wrapper: same API as fetch, but shows the auth prompt
 * on 401 responses and throws so the caller's catch block fires.
 */
export async function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    showAuthPrompt();
    throw new Error("Sign in required");
  }
  return res;
}

export function AuthPromptProvider({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onAuthRequired() {
      setShow(true);
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  return (
    <>
      {children}

      {show && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}
        >
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-8 w-full max-w-sm mx-4 animate-slideUp text-center">
            <div className="text-5xl mb-4">🔒</div>
            <h2 className="text-xl font-black text-white mb-2">
              Sign in to continue
            </h2>
            <p className="text-zinc-400 text-sm mb-6">
              Create an account or log in to place bets, invest in agents, and more.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShow(false); router.push("/login"); }}
                className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-black hover:from-amber-300 hover:to-orange-400 transition-all"
              >
                Log In
              </button>
              <button
                onClick={() => { setShow(false); router.push("/signup"); }}
                className="w-full py-3 rounded-xl font-bold border border-white/10 text-white hover:bg-white/5 transition-all"
              >
                Create Account
              </button>
              <button
                onClick={() => setShow(false)}
                className="text-zinc-600 text-sm hover:text-zinc-400 transition-colors mt-1"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
