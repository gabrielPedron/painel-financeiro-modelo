import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const APP_LOGO_QUERY_KEY = ["app-logo"] as const;

export function useAppLogo() {
  return useQuery({
    queryKey: APP_LOGO_QUERY_KEY,
    queryFn: async (): Promise<{ path: string | null; url: string | null; iconPath: string | null; iconUrl: string | null }> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return { path: null, url: null, iconPath: null, iconUrl: null };
      const { data, error } = await supabase.rpc("team_app_settings");
      if (error) throw error;
      const row = data?.[0];
      const path = row?.logo_url ?? null;
      const iconPath = row?.logo_icon_url ?? null;
      const sign = async (p: string | null) => {
        if (!p) return null;
        const { data: s } = await supabase.storage.from("logos").createSignedUrl(p, 60 * 60);
        return s?.signedUrl ?? null;
      };
      const [url, iconUrl] = await Promise.all([sign(path), sign(iconPath)]);
      return { path, url, iconPath, iconUrl };
    },
    staleTime: 5 * 60_000,
  });
}