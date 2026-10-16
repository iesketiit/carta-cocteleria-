export const money = (n: number, currency = 'USD') =>
  `${currency === 'USD' ? '$' : ''}${(Math.round((n || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '')}${
    currency === 'USD' ? '' : ' ' + currency
  }`;

export const SPIRITS: { key: string; label: string }[] = [
  { key: 'whisky', label: 'Whisky' },
  { key: 'tequila', label: 'Tequila' },
  { key: 'ron', label: 'Ron' },
  { key: 'vodka', label: 'Vodka' },
  { key: 'gin', label: 'Gin' },
  { key: 'aguardiente', label: 'Aguardiente' },
  { key: 'otro', label: 'Otros' },
];

export const spiritLabel = (k: string) => SPIRITS.find(s => s.key === k)?.label ?? 'Otros';

export const KINDS: { key: string; label: string }[] = [
  { key: 'coctel', label: 'Cóctel' },
  { key: 'botella', label: 'Botella' },
  { key: 'shot', label: 'Shot' },
  { key: 'sin_alcohol', label: 'Sin alcohol' },
  { key: 'otro', label: 'Otro' },
];

export const PAY_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deuna: 'DeUna',
};

export const ROLE_LABEL: Record<string, string> = {
  caja_entradas: 'Caja de entradas (efectivo)',
  cajero_barra: 'Cajero de barra',
  bartender: 'Bartender',
  inventario: 'Inventario / admin de barra',
};

export const uuid = (): string =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
