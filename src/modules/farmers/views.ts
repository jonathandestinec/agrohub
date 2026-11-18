import type { Crop, FarmerProfile, User } from "@/generated/prisma/client";
import type { TileItem } from "@/lib/summary";

// A profile row with its crops loaded (`include: PROFILE_CROPS` in the service).
export type ProfileWithCrops = FarmerProfile & { crops: Pick<Crop, "id" | "name" | "nameKey">[] };

type FarmerUser = Pick<User, "id" | "name" | "email" | "phone" | "phoneConfirmed">;

// What the farmer sees of their own profile on /farmer and /join.
export type OwnFarmer = {
  farmSizeHectares: string;
  crops: { id: string; name: string }[];
  state: string;
  lga: string;
};

// What an officer of the farmer's cooperative sees. No phone, email or bank data:
// only whether a payout account has been added.
export type OfficerFarmer = OwnFarmer & {
  id: string;
  userId: string;
  name: string;
  cooperativeId: string;
  hasBankAccount: boolean;
};

// Admins also see contact details and whether the phone was confirmed (spec 6.2).
export type AdminFarmer = OfficerFarmer & {
  email: string;
  phone: string;
  phoneConfirmed: boolean;
  accountName: string | null;
};

// Field by field on purpose: FarmerProfile rows hold the recipient code, which must never
// be added to a view by accident.
export function toOwnFarmer(profile: ProfileWithCrops): OwnFarmer {
  return {
    farmSizeHectares: profile.farmSizeHectares.toString(),
    crops: profile.crops.map((crop) => ({ id: crop.id, name: crop.name })),
    state: profile.state,
    lga: profile.lga,
  };
}

export function toOfficerFarmer(profile: ProfileWithCrops, user: FarmerUser): OfficerFarmer {
  return {
    id: profile.id,
    userId: user.id,
    name: user.name,
    cooperativeId: profile.cooperativeId,
    ...toOwnFarmer(profile),
    hasBankAccount: profile.recipientCode !== null,
  };
}

export function toAdminFarmer(profile: ProfileWithCrops, user: FarmerUser): AdminFarmer {
  return {
    ...toOfficerFarmer(profile, user),
    email: user.email,
    phone: user.phone,
    phoneConfirmed: user.phoneConfirmed,
    accountName: profile.accountName,
  };
}

// A tile item for a membership waiting for approval: the farmer's name and when they asked.
export function toPendingFarmerTileItem(row: { id: string; createdAt: Date; user: { name: string } }): TileItem {
  return { id: row.id, href: "/officer/farmers", title: row.user.name, date: row.createdAt.toISOString() };
}
