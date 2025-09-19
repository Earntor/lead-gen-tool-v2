// _app.js
import "@/styles/globals.css";
import Layout from "../components/layout";
import { createBrowserClient } from "@supabase/ssr";
import { SessionContextProvider } from "@supabase/auth-helpers-react";
import { useEffect, useState } from "react";

export default function App({ Component, pageProps }) {
  const [supabaseClient] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  );

  // ⛔ Blokkeer elke client-call naar /api/lead op de app zelf
  useEffect(() => {
    if (typeof window === "undefined") return;

    const host = window.location.hostname;
    const APP_HOSTS = new Set([
      "lead-gen-tool-v2.vercel.app",
      "localhost",
      "127.0.0.1",
    ]);

    if (!APP_HOSTS.has(host)) return;

    // Optionele vlag die je tracker kan respecteren
    window.__DISABLE_TRACKER__ = true;

    // fetch monkey-patch
    const origFetch = window.fetch;
    window.fetch = async (input, init) => {
      try {
        const url = typeof input === "string" ? input : input?.url || "";
        if (typeof url === "string" && url.includes("/api/lead")) {
          return new Response(
            JSON.stringify({
              ignored: true,
              reason: "blocked on app host (client)",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      } catch {}
      return origFetch(input, init);
    };

    // sendBeacon monkey-patch
    const origBeacon = navigator.sendBeacon?.bind(navigator);
    if (origBeacon) {
      navigator.sendBeacon = (url, data) => {
        try {
          if (typeof url === "string" && url.includes("/api/lead")) {
            return true; // noop, doe alsof het gelukt is
          }
        } catch {}
        return origBeacon(url, data);
      };
    }

    // cleanup
    return () => {
      if (origFetch) window.fetch = origFetch;
      if (origBeacon) navigator.sendBeacon = origBeacon;
    };
  }, []);

  return (
    <SessionContextProvider
      supabaseClient={supabaseClient}
      initialSession={pageProps.initialSession}
    >
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </SessionContextProvider>
  );
}
