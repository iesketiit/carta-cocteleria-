import type { jsPDF as JsPDF } from 'jspdf';
import { BarItem, BarProduct, EventLite } from './types';
import { money, spiritLabel } from './format';

export type PaperSize = 'a4' | 'letter';
export type MenuTheme = 'negro' | 'crema';

interface Palette {
  bg: [number, number, number] | null;
  title: [number, number, number];
  section: [number, number, number];
  name: [number, number, number];
  price: [number, number, number];
  muted: [number, number, number];
  line: [number, number, number];
}

const PALETTES: Record<MenuTheme, Palette> = {
  // Lujo oscuro: fondo negro, dorado y crema.
  negro: {
    bg: [11, 6, 7],
    title: [201, 169, 110],
    section: [232, 207, 143],
    name: [243, 231, 207],
    price: [232, 207, 143],
    muted: [176, 160, 136],
    line: [201, 169, 110],
  },
  // Para impresora normal: papel crema/blanco, vinotinto y dorado viejo.
  crema: {
    bg: null,
    title: [114, 47, 55],
    section: [114, 47, 55],
    name: [26, 13, 15],
    price: [114, 47, 55],
    muted: [96, 84, 74],
    line: [154, 122, 63],
  },
};

const SECTIONS: { key: BarProduct['kind']; title: string }[] = [
  { key: 'coctel', title: 'Cócteles' },
  { key: 'shot', title: 'Shots' },
  { key: 'botella', title: 'Botellas' },
  { key: 'sin_alcohol', title: 'Sin alcohol' },
  { key: 'otro', title: 'Otros' },
];

const FONTS: { file: string; name: string; style: string }[] = [
  { file: 'Marcellus_400Regular.ttf', name: 'Marcellus', style: 'normal' },
  { file: 'Poppins_300Light.ttf', name: 'Poppins', style: 'light' },
  { file: 'Poppins_500Medium.ttf', name: 'Poppins', style: 'medium' },
];

const fontCache = new Map<string, string>();

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
};

// Marcellus + Poppins dentro del PDF (se ve igual en cualquier imprenta).
// Si no cargan (sin señal), se usan las letras de base del PDF.
const loadFonts = async (doc: JsPDF): Promise<{ display: string; body: string; ok: boolean }> => {
  try {
    for (const f of FONTS) {
      if (!fontCache.has(f.file)) {
        const res = await fetch(`/fonts/${f.file}`);
        if (!res.ok) throw new Error('font');
        fontCache.set(f.file, toBase64(await res.arrayBuffer()));
      }
      doc.addFileToVFS(f.file, fontCache.get(f.file)!);
      doc.addFont(f.file, f.name, f.style);
    }
    return { display: 'Marcellus', body: 'Poppins', ok: true };
  } catch {
    return { display: 'times', body: 'helvetica', ok: false };
  }
};

export interface MenuPdfOptions {
  event: EventLite;
  eventName?: string | null;
  products: BarProduct[];
  items: BarItem[];
  paper: PaperSize;
  theme: MenuTheme;
}

// Carta del evento lista para imprimir (PDF vectorial, con marco dorado,
// secciones por tipo y los cócteles agrupados por licor).
export const downloadMenuPdf = async ({ event, eventName, products, items, paper, theme }: MenuPdfOptions): Promise<void> => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: paper, orientation: 'portrait', compress: true });
  const fonts = await loadFonts(doc);
  const pal = PALETTES[theme];
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 24; // margen del texto
  const BOTTOM = H - 26;

  const bodyLight = () => doc.setFont(fonts.body, fonts.ok ? 'light' : 'normal');
  const bodyMedium = () => doc.setFont(fonts.body, fonts.ok ? 'medium' : 'bold');
  const display = () => doc.setFont(fonts.display, 'normal');

  const diamond = (cx: number, cy: number, r: number) => {
    doc.setFillColor(...pal.line);
    doc.triangle(cx - r, cy, cx, cy - r, cx + r, cy, 'F');
    doc.triangle(cx - r, cy, cx, cy + r, cx + r, cy, 'F');
  };

  const ornamentRule = (y: number, half: number) => {
    doc.setDrawColor(...pal.line);
    doc.setLineWidth(0.2);
    doc.line(W / 2 - half, y, W / 2 - 3, y);
    doc.line(W / 2 + 3, y, W / 2 + half, y);
    diamond(W / 2, y, 1.1);
  };

  const frame = () => {
    if (pal.bg) {
      doc.setFillColor(...pal.bg);
      doc.rect(0, 0, W, H, 'F');
    }
    doc.setDrawColor(...pal.line);
    doc.setLineWidth(0.5);
    doc.rect(8, 8, W - 16, H - 16);
    doc.setLineWidth(0.15);
    doc.rect(10.5, 10.5, W - 21, H - 21);
    for (const [x, y] of [
      [10.5, 10.5],
      [W - 10.5, 10.5],
      [10.5, H - 10.5],
      [W - 10.5, H - 10.5],
    ]) {
      diamond(x, y, 1.4);
    }
  };

  const newPage = (first = false): number => {
    if (!first) doc.addPage(paper, 'portrait');
    frame();
    if (first) return 20;
    display();
    doc.setFontSize(10);
    doc.setTextColor(...pal.title);
    doc.text('403', W / 2, 21, { align: 'center', charSpace: 1.5 });
    ornamentRule(25, 22);
    return 42;
  };

  // ---------------------------------------------------------- Portada
  let y = newPage(true);
  display();
  doc.setTextColor(...pal.title);
  doc.setFontSize(64);
  doc.text('403', W / 2, y + 30, { align: 'center', charSpace: 3 });
  bodyLight();
  doc.setFontSize(11);
  doc.setTextColor(...pal.name);
  doc.text('C A R T A', W / 2, y + 42, { align: 'center', charSpace: 2.2 });
  ornamentRule(y + 49, 34);
  doc.setFontSize(8.5);
  doc.setTextColor(...pal.muted);
  const sub = [eventName, event.city].filter(Boolean).join('  ·  ').toUpperCase();
  if (sub) doc.text(sub, W / 2, y + 57, { align: 'center', charSpace: 1.2 });
  y += 72;

  const active = products
    .filter(p => p.active)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, 'es', { numeric: true }));
  const itemById = new Map(items.map(i => [i.id, i]));

  const ensure = (needed: number) => {
    if (y + needed > BOTTOM) y = newPage();
  };

  // El título nunca queda solo al final de la página: pide espacio para él
  // y para el primer producto.
  const sectionTitle = (title: string) => {
    ensure(42);
    display();
    doc.setFontSize(15);
    doc.setTextColor(...pal.section);
    doc.text(title.toUpperCase(), W / 2, y, { align: 'center', charSpace: 1.6 });
    ornamentRule(y + 4.5, 26);
    y += 14;
  };

  const subTitle = (title: string) => {
    ensure(28);
    bodyMedium();
    doc.setFontSize(8);
    doc.setTextColor(...pal.line);
    doc.text(title.toUpperCase(), M, y, { charSpace: 1.4 });
    doc.setDrawColor(...pal.line);
    doc.setLineWidth(0.15);
    doc.line(M + doc.getTextWidth(title.toUpperCase()) + title.length * 1.4 + 3, y - 1.1, W - M, y - 1.1);
    y += 7;
  };

  const product = (p: BarProduct) => {
    const priceText = money(p.price, event.currency);
    let desc = (p.description || '').trim();
    if (!desc && p.kind === 'botella' && p.bottle_item_id) {
      const it = itemById.get(p.bottle_item_id);
      if (it) desc = `${it.name} · ${it.bottle_ml} ml`;
    }
    bodyLight();
    doc.setFontSize(8.5);
    const descLines: string[] = desc ? doc.splitTextToSize(desc, W - 2 * M - 30) : [];
    ensure(8 + descLines.length * 4 + 4);

    display();
    doc.setFontSize(12.5);
    doc.setTextColor(...pal.name);
    const nameLines: string[] = doc.splitTextToSize(p.name, W - 2 * M - 34);
    doc.text(nameLines, M, y);
    const lastNameY = y + (nameLines.length - 1) * 5.2;
    const nameW = doc.getTextWidth(nameLines[nameLines.length - 1]);

    bodyMedium();
    doc.setFontSize(11);
    doc.setTextColor(...pal.price);
    const priceW = doc.getTextWidth(priceText);
    doc.text(priceText, W - M, lastNameY, { align: 'right' });

    // Línea de puntos entre el nombre y el precio.
    const x1 = M + nameW + 2.5;
    const x2 = W - M - priceW - 2.5;
    if (x2 - x1 > 4) {
      doc.setDrawColor(...pal.line);
      doc.setLineWidth(0.35);
      doc.setLineCap('round');
      doc.setLineDashPattern([0, 1.4], 0);
      doc.line(x1, lastNameY - 0.6, x2, lastNameY - 0.6);
      doc.setLineDashPattern([], 0);
      doc.setLineCap('butt');
    }

    y = lastNameY + 4.6;
    if (descLines.length) {
      bodyLight();
      doc.setFontSize(8.5);
      doc.setTextColor(...pal.muted);
      doc.text(descLines, M, y);
      y += descLines.length * 3.9;
    }
    y += 4.2;
  };

  let printed = 0;
  for (const s of SECTIONS) {
    const list = active.filter(p => p.kind === s.key);
    if (!list.length) continue;
    sectionTitle(s.title);
    if (s.key === 'coctel') {
      const spirits = [...new Set(list.map(p => p.spirit))];
      for (const sp of spirits) {
        if (spirits.length > 1) subTitle(spiritLabel(sp));
        list.filter(p => p.spirit === sp).forEach(product);
        y += 2;
      }
    } else {
      list.forEach(product);
    }
    y += 6;
    printed += list.length;
  }

  if (!printed) {
    bodyLight();
    doc.setFontSize(10);
    doc.setTextColor(...pal.muted);
    doc.text('La carta todavía no tiene productos activos.', W / 2, y + 10, { align: 'center' });
  }

  // ---------------------------------------------------------- Pie
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    bodyLight();
    doc.setFontSize(6.5);
    doc.setTextColor(...pal.muted);
    doc.text('NO TODOS ENTRAN  ·  CÓDIGO 403', W / 2, H - 15, { align: 'center', charSpace: 1.3 });
    doc.setFontSize(6);
    doc.text('Consumo exclusivo para mayores de edad. Bebe con responsabilidad.', W / 2, H - 12, { align: 'center' });
    if (total > 1) doc.text(`${i} / ${total}`, W - 16, H - 12, { align: 'right' });
  }

  const slug = (event.city || 'evento')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  doc.save(`carta-403-${slug}-${theme}.pdf`);
};
