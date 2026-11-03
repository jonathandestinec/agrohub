// A lot can be withdrawn only while no order on it is open (spec 14). There are no orders
// until Phase 5, which implements this check.
export async function hasOpenOrders(lotId: string): Promise<boolean> {
  void lotId;
  return false;
}
