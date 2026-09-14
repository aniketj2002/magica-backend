import { withRoute, jsonOk } from '@/lib/http';
import {
  UPLOAD_MAX_BYTES,
  peek,
  type RateLimitBucket,
} from '@/lib/rate-limit';

export const GET = withRoute({}, async ({ user }) => {
  const buckets: RateLimitBucket[] = ['chat', 'upload'];
  const [chat, upload] = await Promise.all(
    buckets.map((bucket) => peek(user!.id, bucket)),
  );

  return jsonOk({
    chat,
    upload,
    uploadMaxBytes: UPLOAD_MAX_BYTES,
  });
});
