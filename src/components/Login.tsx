import React, { useState } from 'react';
import { supabase, errText } from '../lib/supabase';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/Invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : errText(error));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5">
      <form onSubmit={submit} className="card w-full max-w-sm p-7 space-y-4">
        <div className="text-center mb-2">
          <p className="font-display text-4xl text-cream">403</p>
          <p className="text-[11px] tracking-[0.35em] uppercase text-gold mt-1">Caja · Barra</p>
        </div>
        <input
          className="input"
          type="email"
          autoComplete="email"
          placeholder="Correo"
          value={email}
          onChange={e => setEmail(e.target.value.replace(/\s/g, ''))}
          required
        />
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Contraseña"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button className="btn btn-gold w-full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-[11px] text-cream/40 text-center">Tu usuario lo crea el administrador de 403.</p>
      </form>
    </div>
  );
};
