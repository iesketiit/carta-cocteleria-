import { supabase } from './supabase';
import { uuid } from './format';

const MAX_SIDE = 900;

// Achica la foto en el celular (máx. 900 px, JPG) para que cargue rápido
// en la barra aunque haya poca señal.
const shrink = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No se pudo procesar la foto.'));
      ctx.fillStyle = '#070405';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Ese archivo no es una foto válida (usa JPG, PNG o WebP).'));
    };
    img.src = url;
  });

// Sube la foto al bucket "bar-images" en la carpeta del evento y devuelve
// la dirección pública.
export const uploadProductImage = async (eventId: string, file: File): Promise<string> => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Usa una foto JPG, PNG o WebP.');
  }
  const blob = await shrink(file);
  const path = `${eventId}/${uuid()}.jpg`;
  const { error } = await supabase.storage.from('bar-images').upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from('bar-images').getPublicUrl(path).data.publicUrl;
};
