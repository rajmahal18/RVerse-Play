import { Button, Pill, Section } from "@/components/ui";

export default function BillingSuccessPage() {
  return (
    <main className="mx-auto max-w-2xl px-3 py-8 sm:px-6">
      <Section title="Payment Received" action={<Pill tone="green">Check webhook</Pill>}>
        <div className="space-y-3 text-sm text-slate-600">
          <div>Your payment redirect completed. Organizer access will be confirmed by the PayMongo webhook.</div>
          <div>If access does not update right away, refresh your billing page in a few seconds.</div>
          <div className="flex flex-wrap gap-2">
            <a href="/account/billing"><Button>Open billing</Button></a>
            <a href="/"><Button variant="soft">Back to sessions</Button></a>
          </div>
        </div>
      </Section>
    </main>
  );
}
