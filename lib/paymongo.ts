import { createHmac, timingSafeEqual } from "node:crypto";

const PAYMONGO_BASE_URL = "https://api.paymongo.com/v1";

function getPaymongoAuthHeader() {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("PAYMONGO_SECRET_KEY is not set.");
  }

  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function createPaymongoCheckoutSession(params: {
  amount: number;
  email: string;
  name: string;
  paymentId: string;
  userId: string;
}) {
  const response = await fetch(`${PAYMONGO_BASE_URL}/checkout_sessions`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: getPaymongoAuthHeader(),
    },
    body: JSON.stringify({
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          payment_method_types: ["gcash", "paymaya", "grab_pay", "card"],
          line_items: [
            {
              currency: "PHP",
              amount: params.amount,
              name: "CourtFlow Organizer Access",
              quantity: 1,
              description: "30 days of organizer access",
            },
          ],
          description: "CourtFlow Organizer Access",
          success_url: `${getAppUrl()}/billing/success?paymentId=${params.paymentId}`,
          cancel_url: `${getAppUrl()}/billing/failed?paymentId=${params.paymentId}`,
          billing: {
            name: params.name,
            email: params.email,
          },
          metadata: {
            paymentId: params.paymentId,
            userId: params.userId,
            plan: "ORGANIZER",
          },
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.errors?.[0]?.detail || "Failed to create PayMongo checkout session.");
  }

  return {
    id: data?.data?.id as string | undefined,
    checkoutUrl: data?.data?.attributes?.checkout_url as string | undefined,
    raw: data,
  };
}

export function verifyPaymongoSignature(payload: string, signatureHeader: string | null) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const candidates = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .map((part) => (part.includes("=") ? part.split("=").slice(1).join("=").trim() : part))
    .filter(Boolean);

  return candidates.some((candidate) => safeCompare(candidate, expected));
}

function safeCompare(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function getWebhookEventType(payload: any) {
  return payload?.data?.attributes?.type || payload?.type || "";
}

export function extractWebhookResource(payload: any) {
  return payload?.data?.attributes?.data || payload?.data?.attributes?.resource || payload?.data?.data || null;
}

export function extractPaymentLookup(payload: any) {
  const resource = extractWebhookResource(payload);
  const metadata =
    resource?.attributes?.metadata ||
    resource?.attributes?.checkout_session?.metadata ||
    resource?.attributes?.source?.metadata ||
    {};

  return {
    paymentId: metadata?.paymentId as string | undefined,
    providerReferenceId:
      resource?.id ||
      resource?.attributes?.checkout_session_id ||
      resource?.attributes?.payment_intent_id ||
      resource?.attributes?.source?.id ||
      undefined,
    metadata,
  };
}
