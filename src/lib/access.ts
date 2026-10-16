import { useCallback, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Access, StaffRole } from './types';
import { readLocal, writeLocal } from './store';

const ACCESS_CACHE = '403-barra-acceso';

// Sesión + permisos. Se guardan en el celular para abrir sin señal.
export const useAccess = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(() => readLocal<Access | null>(ACCESS_CACHE, null));
  const [loading, setLoading] = useState(true);

  const loadAccess = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_staff_access');
    if (!error && data) {
      setAccess(data as Access);
      writeLocal(ACCESS_CACHE, data);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadAccess();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadAccess();
      else {
        setAccess(null);
        writeLocal(ACCESS_CACHE, null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadAccess]);

  return { session, access, loading, reload: loadAccess };
};

export const can = (access: Access | null, role: StaffRole, eventId: string | null) =>
  !!access &&
  (access.isAdmin || access.roles.some(r => r.role === role && (r.eventId === null || r.eventId === eventId)));

// Eventos donde tiene algún permiso (admin: todos).
export const myEvents = (access: Access | null) => {
  if (!access) return [];
  if (access.isAdmin || access.roles.some(r => r.eventId === null)) return access.events;
  const ids = new Set(access.roles.map(r => r.eventId));
  return access.events.filter(e => ids.has(e.id));
};
