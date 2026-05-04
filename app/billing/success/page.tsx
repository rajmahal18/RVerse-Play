import { Button, Pill, Section } from "@/components/ui";

export default function BillingSuccessPage() {
  return (
    <main className="mx-auto max-w-2xl px-3 py-8 sm:px-6">
      <Section title="Payment Received" action={<Pill tone="green">Processing</Pill>}>
        <div className="space-y-3 text-sm text-slate-600">
          <div>Your credits will appear shortly.</div>
          <div className="flex flex-wrap gap-2">
            <a href="/account/billing"><Button>Open billing</Button></a>
            <a href="/"><Button variant="soft">Back to sessions</Button></a>
          </div>
        </div>
      </Section>
    </main>
  );
}
