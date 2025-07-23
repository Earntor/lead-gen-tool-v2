// supabase/functions/delete_old_ignored_ips.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async () => {
  const supabase = createClient(
    Deno.env.get("https://supabase.com/dashboard/project/wodorypgdopdruxxanwn")!,
    Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvZG9yeXBnZG9wZHJ1eHhhbnduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjI0MjMxMCwiZXhwIjoyMDY3ODE4MzEwfQ.GOXN7bk4oPiwyEbh8P8pcDhnTy76RHflfP1O_JrWIkU")!
  );

  const { error } = await supabase.rpc("delete_old_ignored_ips");

  if (error) {
    console.error("❌ Error deleting old ignored_ip_log entries:", error);
    return new Response("Error", { status: 500 });
  }

  return new Response("✅ Old ignored_ip_log entries deleted", { status: 200 });
});
