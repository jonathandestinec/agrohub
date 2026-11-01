// Leaving a cooperative is blocked while any order on the farmer's lots is unfinished
// (spec 6.2). There are no orders until Phase 5, which implements this check.
export async function hasUnfinishedOrders(farmerUserId: string): Promise<boolean> {
  void farmerUserId;
  return false;
}
