import type { Metadata } from "next";
import { Onboarding } from "./onboarding";

export const metadata: Metadata = { title: "Join a cooperative" };

// Stands in for /join/[token], the page a farmer opens from an officer's invite link.
export default function JoinDemoPage() {
  return <Onboarding />;
}
