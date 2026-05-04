import { NextResponse } from "next/server";
import { PaymentType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { ORGANIZER_MONTHLY_PRICE, isAdmin } from "@/lib/billing";
import { createPaymongoCheckoutSession } from "@/lib/paymongo";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No active user." }, { status: 401 });
  }

  if (isAdmin(user)) {
    return NextResponse.json({ error: "Admin accounts already have full access for testing." }, { status: 400 });
  }

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      type: PaymentType.ORGANIZER_MONTHLY,
      amount: ORGANIZER_MONTHLY_PRICE,
      currency: "PHP",
      status: "PENDING",
      metadata: {
        email: user.email,
        plan: "ORGANIZER",
      },
    },
  });

  try {
    const checkout = await createPaymongoCheckoutSession({
      amount: ORGANIZER_MONTHLY_PRICE,
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
        metadata: checkout.raw,
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
