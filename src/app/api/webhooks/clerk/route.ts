import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { WebhookEvent } from '@clerk/nextjs/server'
import { UserService } from '../../../../services/user.service'

export async function POST(req: Request) {
  // You can find this in the Clerk Dashboard -> Webhooks -> choose the endpoint
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET

  if (!WEBHOOK_SECRET) {
    throw new Error('Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local')
  }

  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error occured -- no svix headers', {
      status: 400
    })
  }

  // Get the body
  const payload = await req.json()
  const body = JSON.stringify(payload);

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });
    evt = payload as WebhookEvent;
  } catch (err) {
    console.error('Error verifying webhook:', err);
    return new Response('Error occured', {
      status: 400
    })
  }

  // Do something with the payload
  const { id } = evt.data || {};
  const eventType = evt.type;

  if (eventType === 'user.created') {
    const { id: clerkId, email_addresses, first_name, last_name } = evt.data;
    const email = email_addresses[0]?.email_address;
    const name = [first_name, last_name].filter(Boolean).join(' ');

    try {
      await UserService.createUserWithInitialCredits(clerkId, email, name);
      return new Response('User created successfully', { status: 201 })
    } catch (error) {
      console.error('Error creating user via service:', error);
      return new Response('Error creating user', { status: 500 })
    }
  }

  return new Response('', { status: 200 })
}
