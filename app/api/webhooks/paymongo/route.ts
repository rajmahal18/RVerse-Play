import { NextResponse } from "next/server";
import { extractPaymentLookup, getWebhookEventType, verifyPaymongoSignature } from "@/lib/paymongo";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const payloadText = await req.text();
  const signatureHeader = req.headers.get("paymongo-signature");

  if (!verifyPaymongoSignature(payloadText, signatureHeader)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const payload = JSON.parse(payloadText);
  const eventType = getWebhookEventType(payload);
  const lookup = extractPaymentLookup(payload);

  const payment = lookup.paymentId
    ? await prisma.payment.findUnique({ where: { id: lookup.paymentId } })
    : lookup.providerReferenceId
      ? await prisma.payment.findFirst({ where: { providerReferenceId: lookup.providerReferenceId } })
      : null;

  if (!payment) {
    return NextResponse.json({ ok: true, ignored: true, reason: "payment_not_found" });
  }

  if (eventType === "checkout_session.payment.paid" || eventType === "payment.paid") {
    if (payment.status === "PAID") {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    const credits = getPaymentCredits(payment.metadata, lookup.metadata);

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          providerReferenceId: lookup.providerReferenceId || payment.providerReferenceId,
          metadata: payload,
        },
      });

      await tx.user.update({
        where: { id: payment.userId },
        data: {
          creditBalance: { increment: credits },
        },
      });
    });

    return NextResponse.json({ ok: true, status: "PAID", credits });
  }

  if (eventType === "payment.failed") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        providerReferenceId: lookup.providerReferenceId || payment.providerReferenceId,
        metadata: payload,
      },
    });

    return NextResponse.json({ ok: true, status: "FAILED" });
  }

  return NextResponse.json({ ok: true, ignored: true, eventType });
}

function getPaymentCredits(paymentMetadata: unknown, webhookMetadata: unknown) {
  const fromWebhook = readCredits(webhookMetadata);
  if (fromWebhook > 0) return fromWebhook;

  const fromPayment = readCredits(paymentMetadata);
  if (fromPayment > 0) return fromPayment;

  return 0;
}

function readCredits(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const credits = (value as { credits?: unknown }).credits;
  const parsed = Number(credits);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}
