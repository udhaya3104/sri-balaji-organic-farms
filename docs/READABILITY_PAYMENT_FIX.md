# Readability and invoice-specific payment update

Workspace-only typography uses larger headings, 14px desktop table text, 15–16px inputs, black body text and stronger weights. Invoice line amounts use 16–20px text. The espresso sidebar is unchanged. Mobile metric cards reflow to keep larger amounts readable.

Root cause of the reported payment confusion: an order's “Record payment” action passed only the customer ID. The shared payment service allocated oldest invoices first, so an unrelated older invoice could consume all or part of the receipt.

The order action now passes its invoice ID. The payment form shows the selected invoice, invoice total, previously allocated amount, amount due before payment, new amount applied and expected remaining balance. The API validates customer ownership, applies the receipt only to that invoice and leaves any excess as an unapplied advance. General customer receipts retain an explicitly labelled oldest-first option.

Existing posted receipts/allocations were not rewritten. Read-only inspection of the reported SO-1134 / INV-1128 showed two ₹3,000 receipts: ₹3,900 in total had been applied to older INV-1002 and ₹2,100 to INV-1128. Consequently the existing ₹3,900 invoice has a genuine remaining balance of ₹1,800 under its recorded ledger. Correcting an accidental prior receipt requires an explicit reversal/reallocation, not silently changing displayed arithmetic.

Actual verification: 28 tests passed, zero failures; TypeScript check passed; frontend build passed. Added regression tests prove that a ₹3,000 receipt against a selected ₹3,900 invoice leaves ₹900 even when an older unpaid invoice exists. Additional coverage checks excess-as-advance, wrong-customer rejection and rollback. Browser checks verified the order preselects INV-1128, shows its prior ₹2,100 allocation and ₹1,800 due, and that the enlarged text fits the desktop and 390px mobile layouts. No new payments were posted to the user's database during this check.
