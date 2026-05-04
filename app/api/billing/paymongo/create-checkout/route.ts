import { NextResponse } from "next/server";
import { PaymentType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_TOP_UP_CREDITS, getCreditTopUpAmount, isAdmin } from "@/lib/billing";
import { createPaymongoCheckoutSession } from "@/lib/paymongo";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No active user." }, { status: 401 });
  }

  if (isAdmin(user)) {
    return NextResponse.json({ error: "Admin accounts already have unlimited session creation." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const credits = Math.max(5, Math.min(500, Number(body.credits || DEFAULT_TOP_UP_CREDITS)));
  const amount = getCreditTopUpAmount(credits);

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      type: PaymentType.CREDIT_TOP_UP,
      amount,
      currency: "PHP",
      status: "PENDING",
      metadata: {
        credits,
        email: user.email,
        type: "CREDIT_TOP_UP",
      },
    },
  });

  try {
    const checkout = await createPaymongoCheckoutSession({
      amount,
      credits,
      email: user.email,
      name: user.name || user.email,
      paymentId: payment.id,
      userId: user.id,
    });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerReferenceId: checkout.id,
        checkoutUrl: checkout.checkoutUrl,
        metadata: {
          credits,
          checkout: checkout.raw,
        },
      },
    });

    return NextResponse.json({
      checkoutUrl: updated.checkoutUrl,
      paymentId: updated.id,
    });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        metadata: { error: error instanceof Error ? error.message : "Unknown checkout error" },
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create checkout session." },
      { status: 500 },
    );
  }
}
