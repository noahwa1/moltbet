"use client";

import { useState, useEffect } from "react";
import { authFetch } from "./AuthPrompt";
import Link from "next/link";

const COIN_PACKAGES = [
  { amount: 5000, price: "$4.99", label: "5K", popular: false },
  { amount: 10000, price: "$8.99", label: "10K", popular: true },
  { amount: 25000, price: "$19.99", label: "25K", popular: false },
  { amount: 50000, price: "$34.99", label: "50K", popular: false },
  { amount: 100000, price: "$59.99", label: "100K", popular: false },
];

interface AuthUser {
  id: string;
  name: string;
  balance: number;
  email: string;
}

export default function NavBalance() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState(10000);
  const [showShop, setShowShop] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    function updateUser() {
      fetch("/api/auth/me")
        .then((r) => r.json())
        .then((d) => {
          if (d.user) {
            setUser(d.user);
            setBalance(d.user.balance);
          } else {
            setUser(null);
          }
          setLoaded(true);
        })
        .catch(() => {
          setLoaded(true);
        });
    }
    updateUser();
    const interval = setInterval(updateUser, 5000);
    return () => clearInterval(interval);
  }, []);

  async function buyCoins(amount: number) {
    setPurchasing(true);
    try {
      const res = await authFetch("/api/user/coins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBalance(data.balance);
      setSuccess(`+${amount.toLocaleString()} coins!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setPurchasing(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/";
  }

  if (!loaded) return null;

  // Not logged in — show sign in button
  if (!user) {
    return (
      <Link
        href="/login"
        className="bg-gradient-to-r from-amber-400 to-orange-500 text-black rounded-full px-4 py-1.5 text-sm font-bold hover:from-amber-300 hover:to-orange-400 transition-all"
      >
        Sign In
      </Link>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowShop(true)}
          className="bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-1.5 text-amber-400 text-sm font-mono font-bold hover:bg-amber-400/20 hover:border-amber-400/50 transition-all cursor-pointer"
        >
          {balance.toLocaleString()} coins
        </button>

        <div className="relative group">
          <button className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10 transition-all cursor-pointer">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-[10px] font-black text-black">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span className="max-w-[80px] truncate">{user.name}</span>
          </button>
          <div className="absolute right-0 top-full mt-2 w-40 bg-zinc-900 border border-white/10 rounded-xl overflow-hidden shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 text-left text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Success toast */}
      {success && (
        <div className="fixed top-20 right-6 z-[60] bg-emerald-500 text-white px-5 py-3 rounded-lg shadow-xl animate-slideUp font-bold">
          {success}
        </div>
      )}

      {/* Coin shop modal */}
      {showShop && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowShop(false);
          }}
        >
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 animate-slideUp max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-white">Coin Shop</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Current balance:{" "}
                  <span className="text-amber-400 font-mono font-bold">
                    {balance.toLocaleString()}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowShop(false)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors text-xl"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              {COIN_PACKAGES.map((pkg) => (
                <button
                  key={pkg.amount}
                  onClick={() => buyCoins(pkg.amount)}
                  disabled={purchasing}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all disabled:opacity-50 ${
                    pkg.popular
                      ? "border-amber-400/50 bg-amber-400/5 hover:bg-amber-400/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-black text-amber-400 font-mono w-16 text-left">
                      {pkg.label}
                    </div>
                    <div className="text-left">
                      <div className="text-white font-bold">
                        {pkg.amount.toLocaleString()} coins
                      </div>
                      {pkg.popular && (
                        <div className="text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                          Most Popular
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-mono font-bold">
                      {pkg.price}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 text-center">
              <p className="text-zinc-600 text-[10px]">
                Beta: All purchases are simulated. No real money charged.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
