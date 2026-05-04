import { NextResponse } from "next/server";
import { addDays } from "@/lib/billing";
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

    const startsAt = new Date();
    const endsAt = addDays(startsAt, 30);

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          providerReferenceId: lookup.providerReferenceId || payment.providerReferenceId,
          metadata: payload,
        },
      });

      await tx.subscription.create({
        data: {
          userId: payment.userId,
          plan: "ORGANIZER",
          status: "ACTIVE",
          startsAt,
          endsAt,
          provider: "paymongo",
          providerReferenceId: lookup.providerReferenceId || payment.providerReferenceId,
        },
      });

      await tx.user.update({
        where: { id: payment.userId },
        data: {
          plan: "ORGANIZER",
          subscriptionStatus: "ACTIVE",
          subscriptionEndsAt: endsAt,
        },
      });
    });

    return NextResponse.json({ ok: true, status: "PAID" });
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
