import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { Building2, BarChart3 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: Building2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export default function Layout({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const pathname = router.pathname || "";

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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const showHeader =
    NAV_ITEMS.some((item) => pathname.startsWith(item.href)) ||
    pathname === "/account";

  const navItems = pathname === "/account" ? NAV_ITEMS.slice(0, 1) : NAV_ITEMS;

  const showExportButton = pathname === "/dashboard";

  const renderExportButton = () => (
    <button
      onClick={() => window.dispatchEvent(new Event("exportLeads"))}
      className="flex items-center gap-1 border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50 transition"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        className="w-4 h-4"
      >
        <path
          d="M12 3V16M8 12l4 4 4-4"
          stroke="#2CA9BC"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 16v4a1.08,1.08,0,0,1-1.14 1H5.14A1.08,1.08,0,0,1,4,20V16"
          stroke="#000"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Export
    </button>
  );

  const renderAccountMenu = () => (
    <div className="relative account-menu">
      <button
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition"
      >
        <span className="text-sm font-medium text-gray-700">{user?.email}</span>
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
          <Link href="/account#account" className="block px-4 py-2 text-sm hover:bg-gray-50">
            Account
          </Link>
          <Link href="/account#instellingen" className="block px-4 py-2 text-sm hover:bg-gray-50">
            Instellingen
          </Link>
          <Link href="/account#facturen" className="block px-4 py-2 text-sm hover:bg-gray-50">
            Facturen
          </Link>
          <Link href="/account#betaling" className="block px-4 py-2 text-sm hover:bg-gray-50">
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
  );

  return (
    <div className="min-h-[100svh] md:min-h-[100dvh] bg-white text-gray-900 flex flex-col">
      {showHeader && (
        <header className="bg-white border-b">
          {/* Full-bleed: geen max width, geen horizontale padding */}
          <div className="w-full px-0 py-3">
            {/* Eén rij: links logo + tabs, rechts acties */}
            <div className="flex items-center justify-between gap-3">
              {/* LINKS: Logo + tabs direct ernaast */}
              <div className="flex items-center gap-3 min-w-0">
                <Link href="/dashboard" className="shrink-0">
                  <div className="flex items-center gap-2 cursor-pointer">
                    <img
                      src="/Meta_Platforms_Inc._logo.svg"
                      alt="Logo"
                      className="h-8 w-8"
                    />
                    <span className="font-bold text-gray-800">Mijn SaaS</span>
                  </div>
                </Link>

                {user && (
                  <nav className="hidden md:block">
                    <ul className="flex gap-2 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive =
                          pathname === item.href ||
                          pathname.startsWith(`${item.href}/`);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
                                isActive
                                  ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              <span>{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                )}
              </div>

              {/* RECHTS: Export + account */}
              {user && (
                <div className="flex items-center gap-2">
                  {showExportButton && renderExportButton()}
                  {renderAccountMenu()}
                </div>
              )}
            </div>

            {/* Mobiele tabs onder de titel (optioneel) */}
            {user && (
              <nav className="md:hidden mt-3">
                <ul className="flex gap-2 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-2">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive =
                      pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
                            isActive
                              ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}
          </div>
        </header>
      )}

      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
