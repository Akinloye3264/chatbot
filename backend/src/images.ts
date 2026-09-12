import type { Request, Response } from 'express';

export const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export function imageGenerationConfigured() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim());
}

export async function generateImage(request: Request, response: Response) {
  const prompt = request.body?.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > 2048) {
    response.status(400).json({ error: 'Describe your image using 1–2048 characters.' });
    return;
  }
  if (!imageGenerationConfigured()) {
    response.status(503).json({ error: 'Image generation is not configured on this server yet.' });
    return;
  }
  const controller = new AbortController();
  const onClose = () => controller.abort();
  response.on('close', onClose);
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const account = encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID!.trim());
    const result = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${IMAGE_MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.trim(), steps: 4 }),
      signal: controller.signal,
    });
    const body = await result.json().catch(() => null) as { success?: boolean; result?: { image?: string }; errors?: { code?: number }[] } | null;
    if (!result.ok || body?.success === false) {
      const quota = result.status === 429 || body?.errors?.some(error => error.code === 3036);
      response.status(quota ? 429 : 502).json({ error: quota
        ? 'Image generation is currently at its usage limit. Please try again later.'
        : [401, 403].includes(result.status)
          ? 'Image service access was denied. Check the Cloudflare account ID and Workers AI token on the backend.'
          : 'The image service could not complete this request. Try another description or retry later.' });
      return;
    }
    const image = body?.result?.image;
    if (typeof image !== 'string' || !image.length || image.length > 20 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      response.status(502).json({ error: 'The image service returned an invalid image. Please retry.' });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json({ image: { dataUrl: `data:image/jpeg;base64,${image}`, prompt: prompt.trim() } });
  } catch {
    if (!response.destroyed) response.status(controller.signal.aborted ? 504 : 502).json({ error: controller.signal.aborted
      ? 'Image generation took too long. Please retry.' : 'Could not reach the image service. Please retry.' });
  } finally {
    clearTimeout(timer);
    response.off('close', onClose);
  }
}
