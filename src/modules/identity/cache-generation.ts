// Part of the key for the per-request memberships cache in session.ts. A membership write bumps it,
// so a read after the write in the same request (a server action that revalidates and re-renders
// the layout) is looked up again instead of served from before the write. The number only picks a
// cache entry; it never carries data, so sharing it across requests on one server instance can at
// worst cost another in-flight request one extra lookup.
let generation = 0;

export function membershipGeneration(): number {
  return generation;
}

// Call after any write to a Membership row.
export function noteMembershipChange(): void {
  generation += 1;
}
