import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Layout({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };
    fetchUser();
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/login");
  }, [router]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".account-menu")) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header tonen op dashboard en account */}
      {(router.pathname === "/dashboard" || router.pathname === "/account") && (
<header className="bg-white border-b px-4 py-3 flex flex-wrap justify-between items-center gap-4">
          {/* Logo */}
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <img
                src="/logo-placeholder.svg"
                alt="Logo"
                className="h-8 w-8"
              />
              <span className="font-bold text-gray-800">Mijn SaaS</span>
            </div>
          </Link>

          {router.pathname === "/dashboard" && (
  <input
    type="text"
    placeholder="Zoek bedrijf, locatie of pagina..."
    defaultValue={router.query.search || ""}
    onChange={(e) => {
      const term = e.target.value;
      router.replace(
        {
          pathname: "/dashboard",
          query: { ...router.query, search: term },
        },
        undefined,
        { shallow: true }
      );
    }}
    className="border px-3 py-2 rounded text-sm w-full max-w-xs"
  />
)}



          {user && (
            <div className="flex items-center gap-4">
              {/* Export knop */}
              {router.pathname === "/dashboard" && (
                <button
                  onClick={() => window.dispatchEvent(new Event("exportLeads"))}
                  className="flex items-center gap-1 border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50 transition"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12v8m0 0l-4-4m4 4l4-4m0-4V4m0 0L8 4"
                    />
                  </svg>
                  Export
                </button>
              )}

              {/* Profielmenu */}
              <div className="relative account-menu">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition"
                >
                  <span className="text-sm font-medium text-gray-700">{user.email}</span>
                  <svg
                    className={`w-4 h-4 text-gray-500 transform transition ${
                      menuOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 z-10 bg-white border rounded-lg shadow-md w-48">
                    <Link
                      href="/account#account"
                      className="block px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Account
                    </Link>
                    <Link
                      href="/account#instellingen"
                      className="block px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Instellingen
                    </Link>
                    <Link
                      href="/account#facturen"
                      className="block px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Facturen
                    </Link>
                    <Link
                      href="/account#betaling"
                      className="block px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Betaalmethode
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-100"
                    >
                      Uitloggen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </header>
      )}

      {/* Page content */}
      <main>{children}</main>
    </div>
  );
}
