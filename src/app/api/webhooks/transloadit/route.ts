import { AttachmentService } from '@/services/attachment.service';
import { AppError } from '@/lib/errors';
import { jsonError } from '@/lib/http';

export const maxDuration = 60;

/**
 * Transloadit assembly notification (multipart form: `transloadit` + `signature`).
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const transloaditField = form.get('transloadit');
    const signatureField = form.get('signature');

    const transloaditPayload =
      typeof transloaditField === 'string'
        ? transloaditField
        : transloaditField instanceof File
          ? await transloaditField.text()
          : null;

    if (!transloaditPayload) {
      return new Response('Missing transloadit field', { status: 400 });
    }

    const signature =
      typeof signatureField === 'string'
        ? signatureField
        : signatureField instanceof File
          ? await signatureField.text()
          : null;

    const result = await AttachmentService.handleWebhook({
      transloaditPayload,
      signature,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (AppError.isAppError(error) && error.status === 401) {
      return new Response('Invalid signature', { status: 400 });
    }
    return jsonError(error);
  }
}
