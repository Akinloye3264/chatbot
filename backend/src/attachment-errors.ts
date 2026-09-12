export function attachmentFailure(vision: boolean, status?: number, timedOut = false, empty = false) {
  if (!vision) return { status: 422, error: 'This file could not be read or returned no text. Try a different file or a clearer crop.' };
  if (empty) return { status: 502, error: 'The image service returned no description. This does not mean your image has no text. Please retry.' };
  if (status === 429) return { status: 429, error: 'Image analysis has reached its API usage limit. Please retry later.' };
  if (status === 401 || status === 403) return { status: 502, error: 'Image analysis access was denied. Check the Groq keys and vision-model permissions on the backend.' };
  if (status === 404) return { status: 502, error: 'The configured image-analysis model is unavailable. Check GROQ_VISION_MODEL on the backend.' };
  if (timedOut || status === 408 || status === 504) return { status: 504, error: 'The image service took too long to respond. Please retry.' };
  if (status === 400 || status === 413 || status === 422) return { status: 422, error: 'The image service rejected this image or its request settings. Try a JPEG or PNG crop; if this repeats, check the backend vision configuration.' };
  return { status: 502, error: 'The image-analysis service could not complete the request. This does not mean your image has no text. Please retry.' };
}
