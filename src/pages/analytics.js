import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

export default function Analytics() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const ensureAuthenticated = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login?next=/analytics");
        return;
      }

      if (isActive) {
        setLoading(false);
      }
    };

    ensureAuthenticated();

    return () => {
      isActive = false;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-600">Analytics laden...</p>
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
        <p className="text-gray-600">
          Hier verschijnen straks alle inzichten over je bezoekers en leads.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-gray-700">Komt binnenkort</p>
          <p className="mt-2 text-sm text-gray-500">
            We werken aan grafieken en statistieken die je helpen trends te ontdekken.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-gray-700">Feedback?</p>
          <p className="mt-2 text-sm text-gray-500">
            Laat ons weten welke inzichten voor jou het belangrijkst zijn.
          </p>
        </div>
      </div>
    </section>
  );
}
